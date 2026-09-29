import { describe, expect, it, vi } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { NestedDiagramRequests } from "./nested-diagram-requests.js";
import type { WebviewToExtension } from "./gestures.js";

function layout(className: string): DiagramLayout {
  return { kind: "diagram", className } as unknown as DiagramLayout;
}

describe("NestedDiagramRequests", () => {
  it("posts a nestedDiagramRequest carrying a fresh requestId, and resolves on the matching result", async () => {
    const posted: WebviewToExtension[] = [];
    const requests = new NestedDiagramRequests((msg) => posted.push(msg));

    const pending = requests.request("A.B");
    expect(posted).toHaveLength(1);
    const sent = posted[0];
    if (sent?.type !== "nestedDiagramRequest") throw new Error("wrong type");
    expect(sent.className).toBe("A.B");

    requests.handleResult({
      type: "nestedDiagramResult",
      requestId: sent.requestId,
      className: "A.B",
      layout: layout("A.B"),
    });

    await expect(pending).resolves.toEqual(layout("A.B"));
  });

  it("mints a distinct requestId per call", () => {
    const posted: WebviewToExtension[] = [];
    const requests = new NestedDiagramRequests((msg) => posted.push(msg));

    void requests.request("A.B").catch(() => {});
    void requests.request("A.B").catch(() => {});

    const ids = posted.map((m) =>
      m.type === "nestedDiagramRequest" ? m.requestId : undefined,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("rejects with the host's reported error", async () => {
    const posted: WebviewToExtension[] = [];
    const requests = new NestedDiagramRequests((msg) => posted.push(msg));

    const pending = requests.request("A.B");
    const sent = posted[0];
    if (sent?.type !== "nestedDiagramRequest") throw new Error("wrong type");

    requests.handleResult({
      type: "nestedDiagramResult",
      requestId: sent.requestId,
      className: "A.B",
      error: "class no longer parses",
    });

    await expect(pending).rejects.toThrow("class no longer parses");
  });

  it("ignores a result for an unknown or already-drained requestId", () => {
    const requests = new NestedDiagramRequests(vi.fn());
    expect(() =>
      requests.handleResult({
        type: "nestedDiagramResult",
        requestId: "nested-does-not-exist",
        className: "A.B",
        layout: layout("A.B"),
      }),
    ).not.toThrow();
  });
});
