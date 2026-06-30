/**
 * Storybook-only glue that closes the loop between
 * `<om-graphical-layout>` and a mutable in-memory `DiagramLayout`. In
 * production this round-trip lives in the VSCode extension (event →
 * `addConnection` RPC → OMC re-fetch → push new layout). Here we just
 * append directly so the visual story is end-to-end usable without
 * spinning up an extension host.
 */

import type {
  ClassDef,
  ConnectionEndpoint,
  DiagramLayout,
  Point,
} from "@dicode/omc-client";

/**
 * Parse a connector key (`k:p` for standalone, `k:R1.p` for nested)
 * into the `{component, port}` shape that `ConnectionLayout` expects.
 * Returns `null` for malformed input — caller decides whether to skip
 * the event or surface an error.
 */
export function endpointFromKey(key: string): ConnectionEndpoint | null {
  const idx = key.indexOf(":");
  if (idx < 0 || key.slice(0, idx) !== "k") {
    return null;
  }
  const id = key.slice(idx + 1);
  const dot = id.indexOf(".");
  if (dot < 0) {
    return { component: undefined, port: id };
  }
  return { component: id.slice(0, dot), port: id.slice(dot + 1) };
}

/**
 * Append a freshly-created connection to a layout and return the
 * new layout. Returns the original if either endpoint can't be
 * parsed — keeps the story render side-effect-free.
 */
export function appendConnection(
  layout: DiagramLayout,
  detail: {
    fromKey: string;
    toKey: string;
    waypoints: ReadonlyArray<readonly [number, number]>;
  },
): DiagramLayout {
  const lhs = endpointFromKey(detail.fromKey);
  const rhs = endpointFromKey(detail.toKey);
  if (!lhs || !rhs) {
    return layout;
  }
  const waypoints: Point[] = detail.waypoints.map(([x, y]) => [x, y] as Point);
  return {
    ...layout,
    connections: [...layout.connections, { lhs, rhs, waypoints }],
  };
}

/** Short (unqualified) name of a Modelica class path. */
function shortName(className: string): string {
  return className.split(".").pop() ?? className;
}

/**
 * Minimal stand-in class for a library pick the layout doesn't already
 * know about. In the extension the host re-fetches the real icon from
 * OMC; here a labelled box keeps the freshly-added component visible.
 */
function placeholderClass(className: string): ClassDef {
  return {
    name: className,
    restriction: "block",
    iconLayers: [
      {
        from: className,
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-100, -100],
              [100, 100],
            ],
            lineColor: [0, 0, 127],
            fillColor: [245, 245, 250],
            pattern: "Solid",
            fillPattern: "Solid",
            lineThickness: 0.25,
          },
          {
            kind: "text",
            extent: [
              [-90, -40],
              [90, 40],
            ],
            textString: shortName(className),
            textColor: [0, 0, 127],
            fontSize: 0,
          },
        ],
      } as ClassDef["iconLayers"][number],
    ],
    connectors: {},
    parameters: {},
  };
}

/** First free `<short><n>` instance name for a class in the layout. */
function uniqueComponentName(layout: DiagramLayout, className: string): string {
  const base = shortName(className).replace(/[^A-Za-z0-9_]/g, "") || "comp";
  const lower = base.charAt(0).toLowerCase() + base.slice(1);
  let n = 1;
  while (layout.components[`${lower}${n}`]) {
    n += 1;
  }
  return `${lower}${n}`;
}

/**
 * Append a component instantiated from `className` at a drop point,
 * mirroring the extension's add-component round-trip (event → addComponent
 * RPC → OMC re-fetch → new layout). Synthesises a placeholder class when
 * the layout doesn't already carry the picked class's icon.
 */
export function appendComponent(
  layout: DiagramLayout,
  className: string,
  position: { x: number; y: number },
): DiagramLayout {
  const name = uniqueComponentName(layout, className);
  const half = 10;
  const classes = layout.classes[className]
    ? layout.classes
    : { ...layout.classes, [className]: placeholderClass(className) };
  return {
    ...layout,
    classes,
    components: {
      ...layout.components,
      [name]: {
        name,
        classRef: className,
        placement: {
          extent: [
            [position.x - half, position.y - half],
            [position.x + half, position.y + half],
          ],
        },
      },
    },
  };
}
