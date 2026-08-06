import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { ClassInvalidationRegistry } from "./invalidation.js";
import { publishSourceChanges } from "./source-invalidation.js";
import { sourceUriFor } from "./source-provider.js";

function makeWiring() {
  const emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  const invalidation = new ClassInvalidationRegistry();
  const changed = vi.fn();
  invalidation.register(changed);
  publishSourceChanges({ onDidChangeFile: emitter.event }, invalidation);
  return {
    fire: (events: vscode.FileChangeEvent[]) => emitter.fire(events),
    changed,
  };
}

describe("publishSourceChanges", () => {
  it("publishes a class whose source changed", () => {
    const { fire, changed } = makeWiring();

    fire([{ type: vscode.FileChangeType.Changed, uri: sourceUriFor("Lib.A") }]);

    expect(changed.mock.calls).toEqual([["Lib.A"]]);
  });

  it("publishes every changed class in a single broadcast", () => {
    const { fire, changed } = makeWiring();

    fire([
      { type: vscode.FileChangeType.Changed, uri: sourceUriFor("Lib.A") },
      { type: vscode.FileChangeType.Changed, uri: sourceUriFor("Lib.B") },
    ]);

    expect(changed.mock.calls.map((c) => c[0])).toEqual(["Lib.A", "Lib.B"]);
  });

  it("ignores create and delete events — only a content change stales a cache", () => {
    const { fire, changed } = makeWiring();

    fire([
      { type: vscode.FileChangeType.Created, uri: sourceUriFor("Lib.A") },
      { type: vscode.FileChangeType.Deleted, uri: sourceUriFor("Lib.B") },
    ]);

    expect(changed).not.toHaveBeenCalled();
  });

  it("ignores a changed URI that carries no qualified name", () => {
    const { fire, changed } = makeWiring();

    fire([
      { type: vscode.FileChangeType.Changed, uri: vscode.Uri.file("/tmp/x") },
    ]);

    expect(changed).not.toHaveBeenCalled();
  });
});
