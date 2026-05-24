/**
 * Activity-bar tree of loaded Modelica libraries, mirroring OMEdit / dyad-studio's
 * "Components" view. Root nodes are fetched via `getLoadedLibraries`; children
 * are expanded lazily through `getClassNames` + `getClassRestriction` so we
 * don't walk the entire Modelica Standard Library upfront.
 */

import * as vscode from "vscode";

import type { OmcClient } from "@dicode/omc-client";

export interface LibraryNode {
  /** Dotted fully-qualified Modelica name, e.g. `Modelica.Blocks.Math.Add`. */
  readonly qualifiedName: string;
  /** Last segment shown in the tree row. */
  readonly displayName: string;
  /** OMC `getClassRestriction` keyword, or `"library"` for root nodes. */
  readonly restriction: string;
  /** Library version (root nodes only). */
  readonly version?: string;
}

type EnsureClient = () => Promise<OmcClient>;

export class LibraryTreeProvider
  implements vscode.TreeDataProvider<LibraryNode>
{
  private readonly _onDidChange = new vscode.EventEmitter<
    LibraryNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly ensureClient: EnsureClient) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: LibraryNode): vscode.TreeItem {
    const isBranch = isExpandable(node.restriction);
    const item = new vscode.TreeItem(
      node.displayName,
      isBranch
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.qualifiedName;
    item.iconPath = new vscode.ThemeIcon(iconIdFor(node.restriction));
    item.tooltip = node.version
      ? `${node.restriction}: ${node.qualifiedName} (${node.version})`
      : `${node.restriction}: ${node.qualifiedName}`;
    if (node.version) {
      item.description = node.version;
    }
    item.contextValue = `modelica-${node.restriction}`;
    if (isOpenable(node.restriction)) {
      item.command = {
        command: "modelica.openDiagram",
        title: "Open Diagram",
        arguments: [node.qualifiedName],
      };
    }
    return item;
  }

  async getChildren(element?: LibraryNode): Promise<LibraryNode[]> {
    const client = await this.ensureClient();
    if (!element) {
      // Use AllLoadedClasses (no typeName arg) so packages created in-memory
      // via loadString — which never make it into getLoadedLibraries — still
      // appear at the top level. Versions come from getLoadedLibraries when
      // the package is registered as a real library.
      const [{ classNames }, { libraries }] = await Promise.all([
        client.getClassNames({ sort: true }),
        client.getLoadedLibraries(),
      ]);
      const versions = new Map(libraries);
      return this.decorate(classNames, "", versions);
    }
    if (!isExpandable(element.restriction)) {
      return [];
    }
    const { classNames } = await client.getClassNames({
      typeName: element.qualifiedName,
      sort: true,
    });
    return this.decorate(classNames, element.qualifiedName);
  }

  /**
   * Resolve each sibling's restriction in parallel so each row can get a
   * kind-appropriate icon. OMC serializes the calls internally, but firing
   * them as `Promise.all` keeps JS-side latency down.
   */
  private async decorate(
    names: string[],
    parentQualified: string,
    versions?: Map<string, string>,
  ): Promise<LibraryNode[]> {
    const client = await this.ensureClient();
    const restrictions = await Promise.all(
      names.map((name) =>
        client
          .getClassRestriction({
            typeName: parentQualified ? `${parentQualified}.${name}` : name,
          })
          .then((r) => r.restriction)
          .catch(() => "class"),
      ),
    );
    return names.map((name, i) => {
      const qualifiedName = parentQualified ? `${parentQualified}.${name}` : name;
      const restriction = restrictions[i] ?? "class";
      const version = versions?.get(name);
      const node: LibraryNode = {
        qualifiedName,
        displayName: name,
        // Show the "library" pill for any top-level entry that's registered
        // with a version, so MSL still renders as a library not a plain
        // package.
        restriction: version ? "library" : restriction,
        ...(version ? { version } : {}),
      };
      return node;
    });
  }
}

/** Only packages (and library roots) own nested classes. */
function isExpandable(restriction: string): boolean {
  return restriction === "package" || restriction === "library";
}

/**
 * Restrictions that have a meaningful diagram. Connectors and records would
 * usually open as text — keep V1 to the obviously-graphical kinds.
 */
function isOpenable(restriction: string): boolean {
  return (
    restriction === "model" ||
    restriction === "block" ||
    restriction === "class"
  );
}

function iconIdFor(restriction: string): string {
  switch (restriction) {
    case "library":
      return "library";
    case "package":
      return "folder";
    case "model":
      return "symbol-class";
    case "block":
      return "symbol-method";
    case "function":
      return "symbol-function";
    case "connector":
      return "symbol-interface";
    case "record":
      return "symbol-struct";
    case "type":
      return "symbol-misc";
    case "operator":
      return "symbol-operator";
    default:
      return "symbol-class";
  }
}
