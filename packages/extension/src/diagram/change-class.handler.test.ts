/**
 * Unit tests for the `onChangeClassRequest` handler inside `openDiagram`.
 *
 * The handler shows a VSCode input box pre-filled with the component's current
 * type, then calls `setElementType` if the user confirmed a different value.
 *
 * Branches covered:
 *   - happy path: new class entered → setElementType called, layout refreshed;
 *   - user cancels the input box → no setElementType call;
 *   - user confirms the same class (no change) → no setElementType call;
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
    listChildren = vi.fn();
    searchAll = vi.fn();
  },
}));

const { openDiagram } = await import("./open-diagram.js");

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
  // Default: user confirms the new class name.
  vi.spyOn(vscodeMock.window, "showInputBox").mockResolvedValue(
    "Modelica.Blocks.Math.Abs",
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

  it("does nothing when the user cancels the input box", async () => {
    const { client, setElementType } = makeClient();
    await openAndCapture(client);

    vi.spyOn(vscodeMock.window, "showInputBox").mockResolvedValue(undefined);

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

    // User confirms the same value as currentClass.
    vi.spyOn(vscodeMock.window, "showInputBox").mockResolvedValue(
      "Modelica.Blocks.Math.Gain",
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
