/**
 * Unit tests for the `onChangeClassRequest` handler inside `openDiagram`.
 *
 * The handler opens a searchable class quick pick, then calls `setElementType`
 * if the user picked a different class.
 *
 * Branches covered:
 *   - happy path: new class picked → setElementType called, layout refreshed;
 *   - user cancels the quick pick → no setElementType call;
 *   - user picks the same class (no change) → no setElementType call;
 *   - OMC returns success=false → error toast, no layout refresh;
 *   - RPC throws → error toast, no layout refresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import type {
  DiagramLayout,
  ModelInstance,
  OmcClient,
} from "@dicode/omc-client";

import * as vscodeMock from "../../test-support/vscode-mock.js";
import { recordedMessages } from "../../test-support/vscode-mock.js";

// ── Mocks ─────────────────────────────────────────────────────────────

const stubLayout = {
  components: {},
  connectors: {},
  classes: {},
  connections: [],
} as unknown as DiagramLayout;

vi.mock("@dicode/omc-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dicode/omc-client")>();
  return {
    ...actual,
    diagram: {
      ...actual.diagram,
      produceDiagramLayout: vi.fn(() => stubLayout),
      parseInstantiatedParameters: vi.fn(() => ({})),
    },
  };
});

vi.mock("./display-unit.js", () => ({
  applyDisplayUnits: vi.fn((layout: DiagramLayout) => layout),
}));

vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("./parameter-edits.js", () => ({
  findSubComponent: vi.fn(),
  buildComponentParameterForm: vi.fn(),
  buildClassParameterForm: () => undefined,
  classParameterValueToExpr: () => "",
  componentParameterEditPlan: () => [],
  componentParameterElementName: (c: string, n: string) => `${c}.${n}`,
  componentParameterValueToExpr: () => "",
}));

let capturedHandlers: Record<string, (...args: never[]) => unknown>;
const fakePanel = {
  update: vi.fn(),
  openParameters: vi.fn(),
  closeParameters: vi.fn(),
};
vi.mock("./panel.js", () => ({
  DiagramPanel: {
    open: (
      _uri: unknown,
      _className: string,
      _layout: DiagramLayout,
      handlers: Record<string, (...args: never[]) => unknown>,
    ) => {
      capturedHandlers = handlers;
      return fakePanel;
    },
  },
}));

vi.mock("./library-source.js", () => ({
  LibraryBrowserSource: class {
    listChildren = vi.fn().mockResolvedValue([]);
    searchAll = vi.fn().mockResolvedValue([]);
  },
}));

const { openDiagram } = await import("./open-diagram.js");

/**
 * Minimal `QuickPick` double for `pickClassToSwap`: on `show()` it fires
 * `onDidAccept` with `pickedLabel` selected, or `onDidHide` when the label is
 * `undefined` (the user dismissed the picker).
 */
function stubQuickPick(pickedLabel: string | undefined): unknown {
  let acceptCb: (() => void) | undefined;
  let hideCb: (() => void) | undefined;
  const qp = {
    title: "",
    placeholder: "",
    matchOnDescription: false,
    busy: false,
    items: [] as unknown[],
    value: "",
    selectedItems: [] as { label: string }[],
    onDidChangeValue: () => ({ dispose: () => {} }),
    onDidAccept: (cb: () => void) => {
      acceptCb = cb;
      return { dispose: () => {} };
    },
    onDidHide: (cb: () => void) => {
      hideCb = cb;
      return { dispose: () => {} };
    },
    show: () => {
      queueMicrotask(() => {
        if (pickedLabel !== undefined) {
          qp.selectedItems = [{ label: pickedLabel }];
          acceptCb?.();
        } else {
          hideCb?.();
        }
      });
    },
    hide: () => hideCb?.(),
    dispose: () => {},
  };
  return qp;
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeClient(
  opts: {
    setElementTypeResult?: { success: boolean };
    setElementTypeThrows?: Error;
    errorString?: string;
  } = {},
): {
  client: OmcClient;
  setElementType: ReturnType<typeof vi.fn>;
} {
  const setElementType = opts.setElementTypeThrows
    ? vi.fn().mockRejectedValue(opts.setElementTypeThrows)
    : vi.fn().mockResolvedValue(opts.setElementTypeResult ?? { success: true });
  const invoke = vi.fn((method: string) => {
    if (method === "getModelInstance") {
      return Promise.resolve({ instance: {} as ModelInstance });
    }
    if (method === "getInstantiatedParametersAndValues") {
      return Promise.resolve({ result: "" });
    }
    return Promise.resolve({});
  });
  const client = {
    invoke,
    setElementType,
    getErrorString: vi
      .fn()
      .mockResolvedValue({ errorString: opts.errorString ?? "" }),
    convertUnits: vi.fn().mockResolvedValue({ success: false }),
    lastCall: "setElementType(Sample.gain1, Modelica.Blocks.Math.Gain)",
  } as unknown as OmcClient;
  return { client, setElementType };
}

const fakeContext = { extensionUri: {} } as unknown as ExtensionContext;

async function openAndCapture(client: OmcClient): Promise<void> {
  await openDiagram(fakeContext, client, "Sample");
}

// ── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  recordedMessages.length = 0;
  capturedHandlers = {};
  fakePanel.update.mockReset();
  fakePanel.openParameters.mockReset();
  fakePanel.closeParameters.mockReset();
  // Default: user picks a different class from the quick pick.
  vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
    () => stubQuickPick("Modelica.Blocks.Math.Abs") as never,
  );
});

afterEach(() => {
  recordedMessages.length = 0;
  vi.restoreAllMocks();
});

describe("onChangeClassRequest handler", () => {
  it("calls setElementType and refreshes the layout on success", async () => {
    const { client, setElementType } = makeClient();
    await openAndCapture(client);

    await capturedHandlers.onChangeClassRequest!(
      "gain1" as never,
      "Modelica.Blocks.Math.Gain" as never,
    );

    expect(setElementType).toHaveBeenCalledOnce();
    expect(setElementType).toHaveBeenCalledWith({
      typeName: "Sample.gain1",
      newTypeName: "Modelica.Blocks.Math.Abs",
    });
    expect(fakePanel.update).toHaveBeenCalledOnce();
    expect(recordedMessages.filter((m) => m.level === "error")).toHaveLength(0);
  });

  it("does nothing when the user cancels the quick pick", async () => {
    const { client, setElementType } = makeClient();
    await openAndCapture(client);

    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick(undefined) as never,
    );

    await capturedHandlers.onChangeClassRequest!(
      "gain1" as never,
      "Modelica.Blocks.Math.Gain" as never,
    );

    expect(setElementType).not.toHaveBeenCalled();
    expect(fakePanel.update).not.toHaveBeenCalled();
  });

  it("does nothing when the user confirms the same class without change", async () => {
    const { client, setElementType } = makeClient();
    await openAndCapture(client);

    // User picks the same value as currentClass.
    vi.spyOn(vscodeMock.window, "createQuickPick").mockImplementation(
      () => stubQuickPick("Modelica.Blocks.Math.Gain") as never,
    );

    await capturedHandlers.onChangeClassRequest!(
      "gain1" as never,
      "Modelica.Blocks.Math.Gain" as never,
    );

    expect(setElementType).not.toHaveBeenCalled();
    expect(fakePanel.update).not.toHaveBeenCalled();
  });

  it("shows an error toast and skips the refresh when OMC returns success=false", async () => {
    const { client, setElementType } = makeClient({
      setElementTypeResult: { success: false },
      errorString: "type not found",
    });
    await openAndCapture(client);

    await capturedHandlers.onChangeClassRequest!(
      "gain1" as never,
      "Modelica.Blocks.Math.Gain" as never,
    );

    expect(setElementType).toHaveBeenCalledOnce();
    expect(fakePanel.update).not.toHaveBeenCalled();
    const errors = recordedMessages.filter((m) => m.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("setElementType gain1 failed");
    expect(errors[0]?.message).toContain("type not found");
  });

  it("shows an error toast and skips the refresh when the RPC throws", async () => {
    const { client, setElementType } = makeClient({
      setElementTypeThrows: new Error("transport closed"),
    });
    await openAndCapture(client);

    await capturedHandlers.onChangeClassRequest!(
      "gain1" as never,
      "Modelica.Blocks.Math.Gain" as never,
    );

    expect(setElementType).toHaveBeenCalledOnce();
    expect(fakePanel.update).not.toHaveBeenCalled();
    const errors = recordedMessages.filter((m) => m.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("transport closed");
  });
});
