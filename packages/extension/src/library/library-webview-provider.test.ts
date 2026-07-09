/**
 * Message wiring of the library sidebar webview provider. Drives the provider
 * with a fake `WebviewView` and asserts the host end of the bridge: library
 * requests round-trip through `LibrarySource`, a select opens the class,
 * placement forwards to the active diagram, Load Library runs its command, and
 * `refresh()` posts a reload. No live OMC — a plain fake client backs the data.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmcClient } from "@dicode/omc-client";

import { DiagramPanel } from "../diagram/panel.js";
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

  it("opens the class diagram on select", () => {
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "openDiagram", className: "Modelica.Blocks.Math.Gain" });
    expect(executedCommands).toContainEqual({
      command: "modelica.openDiagram",
      args: ["Modelica.Blocks.Math.Gain"],
    });
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
      .spyOn(DiagramPanel, "relayPlacement")
      .mockReturnValue(true);
    const { provider } = makeProvider();
    const { view, send } = fakeView();
    provider.resolveWebviewView(view);
    send({ type: "placementStart", className: "Modelica.Blocks.Math.Gain" });
    send({ type: "placementCancel" });
    expect(relay).toHaveBeenNthCalledWith(1, "Modelica.Blocks.Math.Gain");
    expect(relay).toHaveBeenNthCalledWith(2, null);
  });

  it("posts a reload on refresh()", () => {
    const { provider } = makeProvider();
    const { view, posted } = fakeView();
    provider.resolveWebviewView(view);
    provider.refresh();
    expect(posted).toContainEqual({ type: "reload" });
  });
});
