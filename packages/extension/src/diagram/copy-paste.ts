import type { DiagramLayout, Placement, Shape } from "@dicode/omc-client";

import {
  offsetExtent,
  offsetShape,
  type ClipboardComponent,
  type ClipboardEntry,
  type ClipboardModifier,
} from "./clipboard.js";
import { placementAnnotation, type GraphicsLayer } from "./diff-layout.js";
import {
  isComponentKey,
  isConnectorKey,
  isShapeKey,
  parseEntityKey,
} from "./entity-key.js";
import { firstFreeName, takenNames } from "./open-diagram.js";
import { lookupHostShape } from "./shape-properties.js";

/** OMC surface the copy path needs: the modifiers authored on a declaration. */
export interface CopyClient {
  getElementModifierNames(input: {
    typeName: string;
    elementName: string;
  }): Promise<{ modifiers: string[] }>;
  getElementModifierValue(input: {
    typeName: string;
    modifier: string;
  }): Promise<{ value: string }>;
}

type MutationResult = { success: boolean; diagnostic?: string | undefined };

/** OMC surface the paste path needs. */
export interface PasteClient {
  addComponent(input: {
    componentName: string;
    componentClass: string;
    intoTypeName: string;
    annotation: string;
  }): Promise<MutationResult>;
  setElementModifierValue(input: {
    typeName: string;
    elementName: string;
    expr: string;
  }): Promise<MutationResult>;
  writeClassGraphics(input: {
    typeName: string;
    layer: GraphicsLayer;
    op: { kind: "add"; shape: Shape };
  }): Promise<MutationResult>;
}

/**
 * Resolve `keys` against `layout` into clipboard items, reading each
 * declaration's authored modifiers from OMC.
 *
 * Keys that name nothing copyable — connections, junctions, ports on a
 * sub-component — are skipped: a rubber-band routinely sweeps them up
 * alongside the components the user meant, and refusing the whole copy over
 * one of them would make multi-select copy unusable.
 */
export async function captureClipboardItems(
  client: CopyClient,
  layout: DiagramLayout,
  keys: readonly string[],
): Promise<ClipboardEntry[]> {
  const items: ClipboardEntry[] = [];
  for (const key of keys) {
    const parsed = parseEntityKey(key);
    if (parsed === null) continue;

    if (isComponentKey(parsed)) {
      const component = layout.components[parsed.nodeId];
      if (component === undefined) continue;
      items.push(
        await captureComponent(
          client,
          layout.className,
          parsed.nodeId,
          component.classRef,
          component.placement,
        ),
      );
      continue;
    }

    // Only a standalone connector on the host class is a declaration of its
    // own; a port on a sub-component belongs to that component's type.
    if (isConnectorKey(parsed) && parsed.componentName === null) {
      const connector = layout.connectors[parsed.nodeId];
      if (connector === undefined) continue;
      items.push(
        await captureComponent(
          client,
          layout.className,
          parsed.nodeId,
          connector.classRef,
          connector.placement,
        ),
      );
      continue;
    }

    if (isShapeKey(parsed)) {
      const found = lookupHostShape(layout, parsed.index, parsed.shapeKind);
      if (found === null) continue;
      items.push({ kind: "shape", shape: found.shape });
    }
  }
  return items;
}

async function captureComponent(
  client: CopyClient,
  hostClass: string,
  name: string,
  className: string,
  placement: Placement,
): Promise<ClipboardComponent> {
  return {
    kind: "component",
    name,
    className,
    extent: placement.extent,
    rotation: placement.rotation ?? 0,
    modifiers: await readModifiers(client, hostClass, name),
  };
}

/**
 * Read the modifiers written on `elementName` in `hostClass`. A modifier that
 * comes back empty carries no binding of its own, and replaying it would clear
 * rather than set — `setElementModifierValue` treats an empty expression as a
 * removal — so it is dropped.
 */
async function readModifiers(
  client: CopyClient,
  hostClass: string,
  elementName: string,
): Promise<ClipboardModifier[]> {
  const { modifiers: names } = await client.getElementModifierNames({
    typeName: hostClass,
    elementName,
  });
  const out: ClipboardModifier[] = [];
  for (const path of names) {
    const { value } = await client.getElementModifierValue({
      typeName: hostClass,
      modifier: `${elementName}.${path}`,
    });
    if (value !== "") out.push({ path, expr: value });
  }
  return out;
}

/** What a paste attempt did, so the caller can report partial failures. */
export interface PasteResult {
  /** Instance names added, in paste order. */
  added: string[];
  /** Shapes appended to the class's own graphics annotation. */
  shapes: number;
  failed: string[];
}

/**
 * Write `items` into `hostClass`, offset by `offset` diagram units.
 *
 * Sequential, and the caller reflects ONCE afterwards: reflecting writes the
 * shadow buffer, which is what records a VSCode undo step, so a reflect per
 * item would turn one paste into N undo steps.
 */
export async function pasteClipboardItems(
  client: PasteClient,
  hostClass: string,
  layout: DiagramLayout,
  items: readonly ClipboardEntry[],
  layer: GraphicsLayer,
  offset: number,
): Promise<PasteResult> {
  const result: PasteResult = { added: [], shapes: 0, failed: [] };
  // The layout is not re-fetched between adds, so every name handed out is
  // recorded here — otherwise a two-component paste would ask for the same
  // free name twice.
  const taken = takenNames(layout);

  for (const item of items) {
    if (item.kind === "shape") {
      const write = await client.writeClassGraphics({
        typeName: hostClass,
        layer,
        op: { kind: "add", shape: offsetShape(item.shape, offset) },
      });
      if (write.success) result.shapes += 1;
      else {
        result.failed.push(
          `paste ${item.shape.kind}: ${write.diagnostic ?? "OMC rejected writeClassGraphics"}`,
        );
      }
      continue;
    }

    const componentName = uniquePasteName(item.name, taken);
    taken.add(componentName);
    const outcome = await pasteComponent(
      client,
      hostClass,
      item,
      componentName,
      offset,
    );
    if (outcome.declared) result.added.push(componentName);
    else taken.delete(componentName);
    if (outcome.failure !== null) result.failed.push(outcome.failure);
  }
  return result;
}

/**
 * `declared` is whether the declaration reached the class, which is NOT the
 * same as success: a rejected modifier write leaves the component in place.
 * Reporting the two separately keeps the caller from handing the name out
 * again — and from skipping the reflect that gives the half-applied paste an
 * undo step.
 */
interface PasteComponentOutcome {
  declared: boolean;
  failure: string | null;
}

async function pasteComponent(
  client: PasteClient,
  hostClass: string,
  item: ClipboardComponent,
  componentName: string,
  offset: number,
): Promise<PasteComponentOutcome> {
  const add = await client.addComponent({
    componentName,
    componentClass: item.className,
    intoTypeName: hostClass,
    annotation: placementAnnotation(
      offsetExtent(item.extent, offset),
      item.rotation,
    ),
  });
  if (!add.success) {
    return {
      declared: false,
      failure: `paste ${item.className}: ${add.diagnostic ?? "OMC rejected addComponent"}`,
    };
  }
  for (const modifier of item.modifiers) {
    const set = await client.setElementModifierValue({
      typeName: hostClass,
      elementName: `${componentName}.${modifier.path}`,
      expr: modifier.expr,
    });
    if (!set.success) {
      return {
        declared: true,
        failure: `paste ${componentName}.${modifier.path}: ${set.diagnostic ?? "OMC rejected setElementModifierValue"}`,
      };
    }
  }
  return { declared: true, failure: null };
}

/**
 * A fresh instance name derived from the copied one: `gain` → `gain1`, and
 * `gain1` → `gain2` rather than `gain11`, so pasting a paste doesn't grow a
 * digit each round.
 */
export function uniquePasteName(
  base: string,
  taken: ReadonlySet<string>,
): string {
  return firstFreeName(base.replace(/\d+$/, ""), taken);
}
