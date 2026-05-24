/**
 * Unit tests for the panel-side `onResetComponentParameters` handler
 * inside `openDiagram` (issue #30, deferred half). The pure
 * `resetComponentParameters` core is covered by
 * `reset-component-parameters.test.ts`; here we exercise the re-fetch /
 * re-open dance the handler wraps around it, focusing on the branches the
 * core test can't reach:
 *
 *   - component vanished after a successful clear → modal closed AND the
 *     submit-translator closure state cleared;
 *   - no editable scalar params left → modal closed AND closure state
 *     cleared;
 *   - a re-fetch (layout-build) failure is logged but doesn't throw and
 *     the re-open still proceeds;
 *   - a re-open (getModelInstance) failure surfaces an error toast.
 *
 * To reach the handler without an extension host we mock the heavy
 * collaborators: `DiagramPanel` (captures the handler bag + records
 * open/close/update calls), the component-form builders (drive the abort
 * branches deterministically), the layout producer + display-unit pass
 * (so the initial open + reset refresh don't need a real ModelInstance),
 * and the logger (a spy, since the real one needs `createOutputChannel`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import type {
  DiagramLayout,
  ModelInstance,
  OmcClient,
} from "@dicode/omc-client";

import { recordedMessages } from "../../test-support/vscode-mock.js";

// ── Mocks ─────────────────────────────────────────────────────────────

const stubLayout = { components: {}, connectors: {}, classes: {} } as unknown as
  DiagramLayout;

// Partial-mock the omc-client package: keep everything real except the
// layout producer, which we don't want to run on a stub ModelInstance.
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

// Layout display-unit enrichment is a passthrough by default. Tests flip
// `failNextLayoutBuild` to make the NEXT build throw — used to drive the
// "refresh failed" branch without depending on mockImplementationOnce
// call ordering across the initial open + the reset refresh.
let failNextLayoutBuild = false;
vi.mock("./display-unit.js", () => ({
  applyDisplayUnits: vi.fn((layout: DiagramLayout) => {
    if (failNextLayoutBuild) {
      failNextLayoutBuild = false;
      throw new Error("layout build boom");
    }
    return layout;
  }),
}));

// Logger needs `createOutputChannel` (absent from the vscode mock); swap
// it for spies so we can also assert on warn/error topics.
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

// Drive the abort branches by controlling form derivation directly.
const findSubComponent = vi.fn();
const buildComponentParameterForm = vi.fn();
vi.mock("./parameter-edits.js", () => ({
  findSubComponent: (...args: unknown[]) => findSubComponent(...args),
  buildComponentParameterForm: (...args: unknown[]) =>
    buildComponentParameterForm(...args),
  // open-diagram also imports these from the parameter-edits module; the
  // class-params + component-params submit paths aren't reached in these
  // tests, but the module must still export them so the imports resolve.
  buildClassParameterForm: () => undefined,
  classParameterValueToExpr: () => "",
  componentParameterEditPlan: () => [],
  componentParameterElementName: (component: string, name: string) =>
    `${component}.${name}`,
  componentParameterValueToExpr: () => "",
}));

// Capture the handler bag passed to DiagramPanel.open and record panel ops.
interface FakePanel {
  open: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  openParameters: ReturnType<typeof vi.fn>;
  closeParameters: ReturnType<typeof vi.fn>;
}
let fakePanel: FakePanel;
let capturedHandlers: Record<string, (...args: never[]) => unknown>;
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

// Library browser source is constructed in openDiagram; stub it out.
vi.mock("./library-source.js", () => ({
  LibraryBrowserSource: class {
    listChildren = vi.fn();
    searchAll = vi.fn();
  },
}));

// Imported AFTER the mocks above so the SUT picks up the doubles.
const { openDiagram } = await import("./open-diagram.js");
const { log } = (await import("../logger.js")) as unknown as {
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
};

// ── Test client / context ─────────────────────────────────────────────

interface ClientOptions {
  /** Make getModelInstance throw on the Nth call (1-based). */
  getModelInstanceThrowsOnCall?: number;
}

function makeClient(opts: ClientOptions = {}): {
  client: OmcClient;
  getModelInstance: ReturnType<typeof vi.fn>;
  removeElementModifiers: ReturnType<typeof vi.fn>;
  setElementModifierValue: ReturnType<typeof vi.fn>;
} {
  let getModelInstanceCalls = 0;
  const getModelInstance = vi.fn(() => {
    getModelInstanceCalls += 1;
    if (getModelInstanceCalls === opts.getModelInstanceThrowsOnCall) {
      throw new Error("getModelInstance boom");
    }
    return { instance: {} as ModelInstance };
  });
  const removeElementModifiers = vi.fn().mockResolvedValue({ success: true });
  const setElementModifierValue = vi
    .fn()
    .mockResolvedValue({ success: true });
  const invoke = vi.fn((method: string) => {
    if (method === "getModelInstance") return getModelInstance();
    if (method === "getInstantiatedParametersAndValues") {
      return Promise.resolve({ result: "" });
    }
    return Promise.resolve({});
  });
  const client = {
    invoke,
    getErrorString: vi.fn().mockResolvedValue({ errorString: "" }),
    convertUnits: vi.fn().mockResolvedValue({ success: false }),
    removeElementModifiers,
    setElementModifierValue,
    lastCall: "removeElementModifiers(Sample, gain, keepRedeclares=true)",
  } as unknown as OmcClient;
  return { client, getModelInstance, removeElementModifiers, setElementModifierValue };
}

const fakeContext = { extensionUri: {} } as unknown as ExtensionContext;

/** A minimal valid component form so the happy re-open path can run. */
function validForm(componentName: string) {
  return {
    model: { className: "Sample", fields: [] },
    values: {},
    refs: {},
    componentName,
  };
}

beforeEach(() => {
  recordedMessages.length = 0;
  failNextLayoutBuild = false;
  fakePanel = {
    open: vi.fn(),
    update: vi.fn(),
    openParameters: vi.fn(),
    closeParameters: vi.fn(),
  };
  capturedHandlers = {};
  findSubComponent.mockReset();
  buildComponentParameterForm.mockReset();
  log.info.mockReset();
  log.warn.mockReset();
  log.error.mockReset();
});
afterEach(() => {
  recordedMessages.length = 0;
});

async function openAndGetHandlers(client: OmcClient): Promise<void> {
  await openDiagram(fakeContext, client, "Sample");
}

describe("onResetComponentParameters handler", () => {
  it("component vanished → closes modal AND clears closure state", async () => {
    const { client, setElementModifierValue } = makeClient();
    await openAndGetHandlers(client);

    // Reset succeeds but the component can't be found afterward.
    findSubComponent.mockReturnValue(undefined);

    await capturedHandlers.onResetComponentParameters!("gain" as never);

    expect(fakePanel.closeParameters).toHaveBeenCalledTimes(1);
    expect(fakePanel.openParameters).not.toHaveBeenCalled();

    // Closure state cleared: a subsequent componentParams submit hits the
    // `componentParamComponentName === null` guard and writes nothing.
    await capturedHandlers.onParametersSubmit!("componentParams" as never, {
      k: 1,
    } as never);
    expect(setElementModifierValue).not.toHaveBeenCalled();
    expect(fakePanel.closeParameters).toHaveBeenCalledTimes(2);
  });

  it("no editable params left → closes modal AND clears closure state", async () => {
    const { client, setElementModifierValue } = makeClient();
    await openAndGetHandlers(client);

    findSubComponent.mockReturnValue({ name: "gain", type: "Gain" });
    buildComponentParameterForm.mockReturnValue(null);

    await capturedHandlers.onResetComponentParameters!("gain" as never);

    expect(fakePanel.closeParameters).toHaveBeenCalledTimes(1);
    expect(fakePanel.openParameters).not.toHaveBeenCalled();

    await capturedHandlers.onParametersSubmit!("componentParams" as never, {
      k: 1,
    } as never);
    expect(setElementModifierValue).not.toHaveBeenCalled();
  });

  it("re-fetch (layout build) failure is logged but does not throw; re-open still proceeds", async () => {
    const { client } = makeClient();
    await openAndGetHandlers(client);

    findSubComponent.mockReturnValue({ name: "gain", type: "Gain" });
    buildComponentParameterForm.mockReturnValue(validForm("gain"));

    // Initial open's layout build already ran above; arm the NEXT one (the
    // reset refresh) to throw so the layout-build path inside the handler
    // fails.
    failNextLayoutBuild = true;

    await expect(
      capturedHandlers.onResetComponentParameters!("gain" as never),
    ).resolves.toBeUndefined();

    // Logged the refresh failure with the expected topic…
    expect(log.error).toHaveBeenCalledWith(
      "componentResetRefetch",
      expect.stringContaining("Sample"),
      expect.any(Error),
    );
    // …but the re-open still happened and no error toast was raised.
    expect(fakePanel.openParameters).toHaveBeenCalledTimes(1);
    expect(recordedMessages.filter((m) => m.level === "error")).toHaveLength(0);
  });

  it("re-open (getModelInstance) failure surfaces an error toast", async () => {
    // The reset itself calls getModelInstance via the refresh; the second
    // getModelInstance the handler makes is for the re-open. The handler
    // makes exactly ONE getModelInstance after the clear (deduped), so
    // throwing on the open-diagram-internal-then-reset sequence's 2nd call
    // hits the reset fetch.
    const { client } = makeClient({ getModelInstanceThrowsOnCall: 2 });
    await openAndGetHandlers(client);

    await capturedHandlers.onResetComponentParameters!("gain" as never);

    const errs = recordedMessages.filter((m) => m.level === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toContain("re-opening the panel failed");
    expect(errs[0]?.message).toContain("getModelInstance boom");
  });

  it("ignores a concurrent second reset while one is in flight", async () => {
    const { client, removeElementModifiers } = makeClient();
    await openAndGetHandlers(client);

    findSubComponent.mockReturnValue({ name: "gain", type: "Gain" });
    buildComponentParameterForm.mockReturnValue(validForm("gain"));

    // Fire two without awaiting the first — the second must early-return.
    const first = capturedHandlers.onResetComponentParameters!("gain" as never);
    const second = capturedHandlers.onResetComponentParameters!("gain" as never);
    await Promise.all([first, second]);

    // Only the first reset's clear RPC ran.
    expect(removeElementModifiers).toHaveBeenCalledTimes(1);
  });
});
