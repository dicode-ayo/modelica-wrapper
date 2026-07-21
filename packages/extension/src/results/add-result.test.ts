import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import {
  buildResultRef,
  resolveResultPath,
  storeResultPath,
} from "./add-result.js";

// A saved view is a `file:` doc; the helpers read `.fsPath` + `.scheme`.
function docUri(fsPath: string): vscode.Uri {
  return { fsPath, scheme: "file" } as vscode.Uri;
}

describe("resolveResultPath", () => {
  it("joins a relative path onto the document's folder", () => {
    expect(resolveResultPath(docUri("/ws/views/run.omresults"), "a.mat")).toBe(
      "/ws/views/a.mat",
    );
  });

  it("returns an absolute path unchanged", () => {
    expect(
      resolveResultPath(docUri("/ws/views/run.omresults"), "/abs/b.mat"),
    ).toBe("/abs/b.mat");
  });
});

describe("storeResultPath", () => {
  const uri = docUri("/ws/views/run.omresults");

  it("relativizes a `.mat` under the document's folder", () => {
    expect(storeResultPath(uri, "/ws/views/a.mat")).toBe("a.mat");
    expect(storeResultPath(uri, "/ws/views/sub/a.mat")).toBe("sub/a.mat");
  });

  it("keeps an absolute path when the `.mat` is outside the document's folder", () => {
    expect(storeResultPath(uri, "/other/b.mat")).toBe("/other/b.mat");
  });

  it("stores absolute for an unsaved (non-file) view — no folder to anchor to", () => {
    const scratch = {
      fsPath: "/Simulation results.omresults",
      scheme: "untitled",
    } as vscode.Uri;
    expect(storeResultPath(scratch, "/ws/a.mat")).toBe("/ws/a.mat");
  });

  it("round-trips with resolveResultPath for an under-folder file", () => {
    const stored = storeResultPath(uri, "/ws/views/sub/a.mat");
    expect(resolveResultPath(uri, stored)).toBe("/ws/views/sub/a.mat");
  });
});

describe("buildResultRef", () => {
  const uri = docUri("/ws/views/run.omresults");

  it("labels from the file stem and relativizes the path", () => {
    const ref = buildResultRef(uri, "/ws/views/DCMotor_res.mat", "import");
    expect(ref.label).toBe("DCMotor_res");
    expect(ref.path).toBe("DCMotor_res.mat");
    expect(ref.source).toBe("import");
    expect(ref.id.length).toBeGreaterThan(0);
    expect(ref.createdAt).toBeTruthy();
  });

  it("carries model + parameters for a simulate ref, absolute path when outside", () => {
    const ref = buildResultRef(uri, "/abs/x.mat", "simulate", {
      model: "Lib.DCMotor",
      parameters: { "motor.R": "0.5" },
    });
    expect(ref.model).toBe("Lib.DCMotor");
    expect(ref.parameters).toEqual({ "motor.R": "0.5" });
    expect(ref.path).toBe("/abs/x.mat");
  });

  it("omits model/parameters when not supplied", () => {
    const ref = buildResultRef(uri, "/ws/views/a.mat", "cache");
    expect(ref.model).toBeUndefined();
    expect(ref.parameters).toBeUndefined();
  });
});
