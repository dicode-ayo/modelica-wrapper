/**
 * Message wiring of the library sidebar webview provider. Drives the provider
 * with a fake `WebviewView` and asserts the host end of the bridge: library
 * requests round-trip through `LibrarySource`, a select opens the class,
 * placement forwards to the active diagram, Load Library runs its command, and
 * `refresh()` posts a reload. No live OMC — a plain fake client backs the data.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@dicode/omc-client";

import { DiagramEditorProvider } from "../diagram/diagram-editor-provider.js";
import type {
  ExtensionToLibraryView,
  LibraryViewToExtension,
} from "../webview/library-view-protocol.js";
import { LibraryWebviewProvider } from "./library-webview-provider.js";
import { executedCommands } from "../../test-support/vscode-mock.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function fakeClient() {
  return {
    getClassNames: vi.fn(async () => ({ classNames: ["Modelica"] })),
    searchClassNames: vi.fn(async () => ({
      classNames: ["Modelica.Blocks.Math.Gain"],
    })),
    getClassRestriction: vi.fn(async () => ({ restriction: "package" })),
    // libraryIconSvg goes through this; throwing drives the "no icon" reply.
    invoke: vi.fn(async () => {
      throw new Error("no annotation");
    }),
    // fetchComponentClass (placement preview) goes through this.
    getModelInstance: vi.fn(async () => ({
      instance: {
        name: "Modelica.Blocks.Math.Gain",
        restriction: "block",
        annotation: {
          Icon: {
            coordinateSystem: {
              extent: [
                [-100, -100],
                [100, 100],
              ],
            },
            graphics: [],
          },
        },
        elements: [],
      },
    })),
  };
}

function fakeView() {
  const posted: ExtensionToLibraryView[] = [];
  let handler: ((m: LibraryViewToExtension) => void) | undefined;
  const webview = {
    html: "",
    options: {},
    cspSource: "vscode-webview:",
    asWebviewUri: (u: unknown) => u,
    postMessage: (m: ExtensionToLibraryView) => {
      posted.push(m);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (h: (m: LibraryViewToExtension) => void) => {
      handler = h;
      return { dispose() {} };
    },
  };
  const view = {
    webview,
    onDidDispose: () => ({ dispose() {} }),
  };
  return {
    view: view as unknown as import("vscode").WebviewView,
    posted,
    send: (m: LibraryViewToExtension) => handler?.(m),
  };
}

function makeProvider() {
  const client = fakeClient();
  const uri = {
    fsPath: "/ext",
    path: "/ext",
  } as unknown as import("vscode").Uri;
  const provider = new LibraryWebviewProvider(
    uri,
    async () => client as unknown as OmcClient,
  );
  return { provider, client };
}

/** A class with no drawable graphics — the icon render still routes through an
 *  OMC read, which is what the freshness probes assert on. */
const EMPTY_ICON_INSTANCE = {
  name: "Lib.A",
  restriction: "model",
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [],
    },
  },
  elements: [],
};

/** `Lib.Sub`, whose icon is inherited from `baseName`. Rendering it records
 *  the base as a dependency, so an edit to the base cascades back to `Lib.Sub`.
 *  Varying `baseName` exercises the reverse-edge prune when the chain changes. */
function subtypeInstance(baseName: string) {
  return {
    name: "Lib.Sub",
    restriction: "model",
    annotation: null,
    elements: [
      {
        $kind: "extends",
        baseClass: {
          name: baseName,
          restriction: "model",
          annotation: {
            Icon: {
              coordinateSystem: {
                extent: [
                  [-100, -100],
                  [100, 100],
                ],
              },
              graphics: [],
            },
          },
          elements: [],
        },
      },
    ],
  };
}

/**
 * A provider whose client answers every icon read — both the cheap
 * `getModelInstanceAnnotation` and the full `getModelInstance` — so a test can
 * assert on WHICH call a render makes. `apis()` lists the OMC method names
 * invoked so far.
 */
function makeInstanceProbe() {
  const client = {
    getClassNames: vi.fn(async () => ({ classNames: ["Modelica"] })),
    searchClassNames: vi.fn(async () => ({ classNames: [] })),
    getClassRestriction: vi.fn(async () => ({ restriction: "model" })),
    invoke: vi.fn(async () => ({ instance: EMPTY_ICON_INSTANCE })),
  };
  const uri = {
    fsPath: "/ext",
    path: "/ext",
  } as unknown as import("vscode").Uri;
  const provider = new LibraryWebviewProvider(
    uri,
    async () => client as unknown as OmcClient,
  );
  const apis = (): unknown[] => client.invoke.mock.calls.map((c) => c[0]);
  return { provider, client, apis };
}

beforeEach(() => {
  executedCommands.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("LibraryWebviewProvider", () => {
  it("sets webview HTML that loads the library-view bundle", () => {
    const { provider } = makeProvider();
    const { view } = fakeView();
    provider.resolveWebviewView(view);
    expect(view.webview.html).toContain("om-library-view-root");
    expect(view.webview.html).toContain("library-view.js");
  });

  it("answers libraryListChildren with qualified items", async () => {
    const { provider } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "libraryListChildren", requestId: "1", parent: null });
    await flush();
    expect(posted).toContainEqual({
      type: "libraryChildren",
      requestId: "1",
      items: [{ qualified: "Modelica", restriction: "package" }],
    });
  });

  it("answers librarySearch with matches", async () => {
    const { provider } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "librarySearch", requestId: "2", query: "Gain" });
    await flush();
    expect(posted).toContainEqual({
      type: "librarySearchResult",
      requestId: "2",
      items: [
        { qualified: "Modelica.Blocks.Math.Gain", restriction: "package" },
      ],
    });
  });

  it("replies with no svg when the icon can't be rendered", async () => {
    const { provider } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "libraryIcon", requestId: "3", className: "Modelica" });
    await flush();
    expect(posted).toContainEqual({
      type: "libraryIconResult",
      requestId: "3",
    });
  });

  it("renders a class's icon once and serves later requests from cache", async () => {
    const { provider, client } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "1", className: "Modelica" });
    await flush();
    const afterFirst = client.invoke.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    send({ type: "libraryIcon", requestId: "2", className: "Modelica" });
    await flush();

    // Rendering instantiates the class in OMC; a cache hit must not re-enter it.
    expect(client.invoke.mock.calls.length).toBe(afterFirst);
  });

  it("collapses concurrent requests for the same class into one render", async () => {
    const { provider, client } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "warm", className: "Modelica" });
    await flush();
    const perRender = client.invoke.mock.calls.length;
    provider.refresh();
    client.invoke.mockClear();

    // Both arrive before the render settles, as a scroll burst does.
    send({ type: "libraryIcon", requestId: "1", className: "Modelica" });
    send({ type: "libraryIcon", requestId: "2", className: "Modelica" });
    await flush();

    expect(client.invoke.mock.calls.length).toBe(perRender);
  });

  it("does not join an in-flight render that started before a refresh", async () => {
    const { provider, client } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    // Hold the first render open across the refresh.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    client.invoke.mockImplementationOnce(async () => {
      await held;
      throw new Error("no annotation");
    });

    send({ type: "libraryIcon", requestId: "1", className: "Modelica" });
    await flush();
    const duringFirst = client.invoke.mock.calls.length;

    provider.refresh();
    // Same class, but the in-flight render carries pre-refresh bytes.
    send({ type: "libraryIcon", requestId: "2", className: "Modelica" });
    await flush();

    expect(client.invoke.mock.calls.length).toBeGreaterThan(duringFirst);
    release();
    await flush();
  });

  it("re-renders icons after a refresh invalidates them", async () => {
    const { provider, client } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "1", className: "Modelica" });
    await flush();
    const afterFirst = client.invoke.mock.calls.length;

    provider.refresh();
    send({ type: "libraryIcon", requestId: "2", className: "Modelica" });
    await flush();

    expect(client.invoke.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("childrenChanged posts a targeted message and keeps the icon cache warm", async () => {
    const { provider, client } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "1", className: "Modelica" });
    await flush();
    const afterFirst = client.invoke.mock.calls.length;

    provider.childrenChanged(null);
    expect(posted.at(-1)).toEqual({
      type: "libraryChildrenChanged",
      parent: null,
    });

    send({ type: "libraryIcon", requestId: "2", className: "Modelica" });
    await flush();
    expect(client.invoke.mock.calls.length).toBe(afterFirst); // cache hit
  });

  it("iconChanged evicts only the named class and posts the targeted message", async () => {
    const { provider, client } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "1", className: "Lib.A" });
    send({ type: "libraryIcon", requestId: "2", className: "Lib.B" });
    await flush();
    const afterWarm = client.invoke.mock.calls.length;

    provider.iconChanged("Lib.A");
    expect(posted.at(-1)).toEqual({
      type: "libraryIconChanged",
      className: "Lib.A",
    });

    send({ type: "libraryIcon", requestId: "3", className: "Lib.B" });
    await flush();
    expect(client.invoke.mock.calls.length).toBe(afterWarm); // B still cached

    send({ type: "libraryIcon", requestId: "4", className: "Lib.A" });
    await flush();
    expect(client.invoke.mock.calls.length).toBeGreaterThan(afterWarm); // A re-renders
  });

  it("a render in flight when iconChanged fires cannot write into the cache", async () => {
    const { provider, client } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    client.invoke.mockImplementationOnce(async () => {
      await held;
      throw new Error("no annotation");
    });

    send({ type: "libraryIcon", requestId: "1", className: "Lib.A" });
    await flush();
    provider.iconChanged("Lib.A"); // disowns the held render
    release();
    await flush();

    const beforeRetry = client.invoke.mock.calls.length;
    send({ type: "libraryIcon", requestId: "2", className: "Lib.A" });
    await flush();
    // A fresh render runs — the disowned result was not cached.
    expect(client.invoke.mock.calls.length).toBeGreaterThan(beforeRetry);
  });

  it("re-renders an edited class from a full instance, not the stale annotation", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    // First paint takes the cheap annotation path.
    send({ type: "libraryIcon", requestId: "1", className: "Lib.A" });
    await flush();
    expect(apis()).toContain("getModelInstanceAnnotation");

    // An edit lands; the next render must re-elaborate rather than trust the
    // annotation read, which still reports the pre-edit state.
    provider.iconChanged("Lib.A");
    client.invoke.mockClear();
    send({ type: "libraryIcon", requestId: "2", className: "Lib.A" });
    await flush();

    expect(apis()).toContain("getModelInstance");
    expect(apis()).not.toContain("getModelInstanceAnnotation");
  });

  it("forces a full instance on the render that replaces one disowned mid-edit", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    // Hold the first (annotation) render open so the edit lands while it is in
    // flight; iconChanged then disowns it and marks the class fresh.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    client.invoke.mockImplementationOnce(async () => {
      await held;
      return { instance: EMPTY_ICON_INSTANCE };
    });

    send({ type: "libraryIcon", requestId: "1", className: "Lib.A" });
    await flush();
    provider.iconChanged("Lib.A");
    release();
    await flush();

    // The replacement render must still re-elaborate, not fall back to the
    // annotation read whose reply predates the edit.
    client.invoke.mockClear();
    send({ type: "libraryIcon", requestId: "2", className: "Lib.A" });
    await flush();
    expect(apis()).toContain("getModelInstance");
    expect(apis()).not.toContain("getModelInstanceAnnotation");
  });

  it("keeps an edited class's freshness across a wholesale reload", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "1", className: "Lib.A" });
    await flush();
    expect(apis()).toContain("getModelInstanceAnnotation");

    // An edit marks the class fresh, then a manual Refresh drops the caches
    // before the mark is consumed; the class must still re-elaborate rather
    // than fall back to the annotation read the reload would otherwise take.
    provider.iconChanged("Lib.A");
    provider.refresh();
    client.invoke.mockClear();
    send({ type: "libraryIcon", requestId: "2", className: "Lib.A" });
    await flush();

    expect(apis()).toContain("getModelInstance");
    expect(apis()).not.toContain("getModelInstanceAnnotation");
  });

  it("re-elaborates a subtype's icon when its base class is edited", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    client.invoke.mockImplementation(async () => ({
      instance: subtypeInstance("Lib.Base"),
    }));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    // Rendering the subtype records `Lib.Base` as a dependency of its icon.
    send({ type: "libraryIcon", requestId: "1", className: "Lib.Sub" });
    await flush();
    expect(apis()).toContain("getModelInstanceAnnotation");

    // Editing the base cascades to the subtype; its inherited icon must
    // re-elaborate even though the subtype itself was not the edited class.
    provider.iconChanged("Lib.Base");
    client.invoke.mockClear();
    send({ type: "libraryIcon", requestId: "2", className: "Lib.Sub" });
    await flush();

    expect(apis()).toContain("getModelInstance");
    expect(apis()).not.toContain("getModelInstanceAnnotation");
  });

  it("drops the stale reverse edge when a subtype's extends chain changes", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    client.invoke
      .mockImplementationOnce(async () => ({
        instance: subtypeInstance("Lib.Base"),
      }))
      .mockImplementation(async () => ({
        instance: subtypeInstance("Lib.Other"),
      }));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    // First render records `Lib.Base` → `Lib.Sub`.
    send({ type: "libraryIcon", requestId: "1", className: "Lib.Sub" });
    await flush();

    // Re-render the subtype against a different base; recording the new edge
    // must prune the old `Lib.Base` → `Lib.Sub` one.
    provider.iconChanged("Lib.Sub");
    send({ type: "libraryIcon", requestId: "2", className: "Lib.Sub" });
    await flush();

    // Editing the former base must no longer reach the subtype: its cached
    // icon stays, so the next request serves the cache without an OMC read.
    client.invoke.mockClear();
    provider.iconChanged("Lib.Base");
    send({ type: "libraryIcon", requestId: "3", className: "Lib.Sub" });
    await flush();

    expect(apis()).toEqual([]);
  });

  it("keeps a subtype's dependency edge when a re-render fails", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    client.invoke
      .mockImplementationOnce(async () => ({
        instance: subtypeInstance("Lib.Base"),
      }))
      .mockImplementation(async () => {
        throw new Error("OMC read failed");
      });
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    // First render records `Lib.Base` → `Lib.Sub`.
    send({ type: "libraryIcon", requestId: "1", className: "Lib.Sub" });
    await flush();

    // A failing re-render reports an unknown chain, not an empty one, so the
    // recorded edge must survive rather than being pruned.
    provider.iconChanged("Lib.Sub");
    send({ type: "libraryIcon", requestId: "2", className: "Lib.Sub" });
    await flush();

    // Editing the base must still reach the subtype: it re-renders rather than
    // serving a cache hit.
    client.invoke.mockClear();
    provider.iconChanged("Lib.Base");
    send({ type: "libraryIcon", requestId: "3", className: "Lib.Sub" });
    await flush();

    expect(apis()).toContain("getModelInstance");
  });

  it("leaves a subtype's cached icon untouched when an unrelated class is edited", async () => {
    const { provider, client, apis } = makeInstanceProbe();
    client.invoke.mockImplementation(async () => ({
      instance: subtypeInstance("Lib.Base"),
    }));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "libraryIcon", requestId: "1", className: "Lib.Sub" });
    await flush();

    // An edit to a class the subtype does not inherit from must not evict it;
    // the next request serves the cache without any OMC read.
    provider.iconChanged("Lib.Unrelated");
    client.invoke.mockClear();
    send({ type: "libraryIcon", requestId: "2", className: "Lib.Sub" });
    await flush();

    expect(apis()).toEqual([]);
  });

  it("abandons a search's queued lookups when the webview cancels it", async () => {
    const { provider, client } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);

    client.searchClassNames.mockResolvedValueOnce({
      classNames: ["A", "B", "C", "D"],
    });
    // Cancel while the first restriction lookup is in flight.
    client.getClassRestriction.mockImplementationOnce(async () => {
      send({ type: "libraryCancel", requestId: "s1" });
      return { restriction: "model" };
    });

    send({ type: "librarySearch", requestId: "s1", query: "a" });
    await flush();

    expect(client.getClassRestriction).toHaveBeenCalledTimes(1);
    // The webview already settled this request; a reply would find no entry.
    expect(posted.filter((m) => m.type === "librarySearchResult")).toHaveLength(
      0,
    );
  });

  it("replies normally to a search that is never cancelled", async () => {
    const { provider } = makeProvider();
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "librarySearch", requestId: "s2", query: "gain" });
    await flush();

    const reply = posted.find((m) => m.type === "librarySearchResult");
    expect(reply).toMatchObject({ requestId: "s2" });
  });

  it("opens the class diagram custom editor on the modelica-source doc", () => {
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "openDiagram", className: "Modelica.Blocks.Math.Gain" });
    const call = executedCommands.find((c) => c.command === "vscode.openWith");
    expect(call).toBeDefined();
    expect(String(call?.args[0])).toBe(
      "modelica-source:/Modelica.Blocks.Math.Gain.mo",
    );
    expect(call?.args[1]).toBe("modelica.diagram");
  });

  it("runs Load Library from the empty-state affordance", () => {
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "loadLibrary" });
    expect(executedCommands).toContainEqual({
      command: "modelica.loadLibrary",
      args: [],
    });
  });

  it("relays placement start and cancel to the active diagram", () => {
    const relay = vi
      .spyOn(DiagramEditorProvider, "relayPlacement")
      .mockReturnValue(true);
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    send({ type: "placementCancel" });
    expect(relay).toHaveBeenNthCalledWith(1, "Modelica.Blocks.Math.Gain");
    expect(relay).toHaveBeenNthCalledWith(2, null);
  });

  it("resolves and relays the preview definition after a placement start", async () => {
    vi.spyOn(DiagramEditorProvider, "relayPlacement").mockReturnValue(true);
    const preview = vi
      .spyOn(DiagramEditorProvider, "relayPlacementPreview")
      .mockReturnValue(true);
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    await flush();

    expect(preview).toHaveBeenCalledTimes(1);
    const [name, def] = preview.mock.calls[0] ?? [];
    expect(name).toBe("Modelica.Blocks.Math.Gain");
    expect((def as { name: string }).name).toBe("Modelica.Blocks.Math.Gain");
  });

  it("relays no preview when the class can't be resolved", async () => {
    vi.spyOn(DiagramEditorProvider, "relayPlacement").mockReturnValue(true);
    const preview = vi
      .spyOn(DiagramEditorProvider, "relayPlacementPreview")
      .mockReturnValue(true);
    const { provider, client } = makeProvider();
    client.getModelInstance.mockRejectedValueOnce(new Error("no such class"));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "placementStart", className: "Bad.Class" });
    await flush();

    expect(preview).not.toHaveBeenCalled();
  });

  it("resolves a class once and serves repeat drags from cache", async () => {
    vi.spyOn(DiagramEditorProvider, "relayPlacement").mockReturnValue(true);
    vi.spyOn(DiagramEditorProvider, "relayPlacementPreview").mockReturnValue(
      true,
    );
    const { provider, client } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    await flush();
    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    await flush();

    // The full model instance is fetched once; the repeat drag reuses it.
    expect(client.getModelInstance).toHaveBeenCalledTimes(1);
  });

  it("retries an unresolvable class on the next drag", async () => {
    vi.spyOn(DiagramEditorProvider, "relayPlacement").mockReturnValue(true);
    vi.spyOn(DiagramEditorProvider, "relayPlacementPreview").mockReturnValue(
      true,
    );
    const { provider, client } = makeProvider();
    client.getModelInstance.mockRejectedValueOnce(new Error("busy"));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);

    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    await flush();
    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    await flush();

    // A failed resolve isn't cached, so the second drag tries again.
    expect(client.getModelInstance).toHaveBeenCalledTimes(2);
  });

  it("runs a row's context-menu command with a populated LibraryNode", () => {
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);
    send({
      type: "libraryNodeCommand",
      command: "savePackage",
      node: {
        qualifiedName: "Modelica.Blocks",
        displayName: "Blocks",
        restriction: "package",
      },
    });
    expect(executedCommands).toContainEqual({
      command: "modelica.savePackage",
      args: [
        {
          qualifiedName: "Modelica.Blocks",
          displayName: "Blocks",
          restriction: "package",
        },
      ],
    });
  });

  it("posts a reload on refresh()", () => {
    const { provider } = makeProvider();
    const { view, posted } = fakeView();
    provider.resolveWebviewView(view);
    provider.refresh();
    expect(posted).toContainEqual({ type: "reload" });
  });
});
