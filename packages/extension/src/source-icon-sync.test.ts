import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { syncIconsWithSource } from "./source-icon-sync.js";
import { sourceUriFor } from "./source-provider.js";

function makeBroadcaster() {
  const emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  return {
    source: { onDidChangeFile: emitter.event },
    fire: (events: vscode.FileChangeEvent[]) => emitter.fire(events),
  };
}

describe("syncIconsWithSource", () => {
  it("re-elaborates the icon of a class whose source changed", () => {
    const { source, fire } = makeBroadcaster();
    const icons = { iconChanged: vi.fn() };
    syncIconsWithSource(source, icons);

    fire([{ type: vscode.FileChangeType.Changed, uri: sourceUriFor("Lib.A") }]);

    expect(icons.iconChanged).toHaveBeenCalledTimes(1);
    expect(icons.iconChanged).toHaveBeenCalledWith("Lib.A");
  });

  it("invalidates every changed class in a single broadcast", () => {
    const { source, fire } = makeBroadcaster();
    const icons = { iconChanged: vi.fn() };
    syncIconsWithSource(source, icons);

    fire([
      { type: vscode.FileChangeType.Changed, uri: sourceUriFor("Lib.A") },
      { type: vscode.FileChangeType.Changed, uri: sourceUriFor("Lib.B") },
    ]);

    expect(icons.iconChanged.mock.calls.map((c) => c[0])).toEqual([
      "Lib.A",
      "Lib.B",
    ]);
  });

  it("ignores create and delete events — only a content change re-elaborates an icon", () => {
    const { source, fire } = makeBroadcaster();
    const icons = { iconChanged: vi.fn() };
    syncIconsWithSource(source, icons);

    fire([
      { type: vscode.FileChangeType.Created, uri: sourceUriFor("Lib.A") },
      { type: vscode.FileChangeType.Deleted, uri: sourceUriFor("Lib.B") },
    ]);

    expect(icons.iconChanged).not.toHaveBeenCalled();
  });

  it("ignores a changed URI that carries no qualified name", () => {
    const { source, fire } = makeBroadcaster();
    const icons = { iconChanged: vi.fn() };
    syncIconsWithSource(source, icons);

    fire([
      { type: vscode.FileChangeType.Changed, uri: vscode.Uri.file("/tmp/x") },
    ]);

    expect(icons.iconChanged).not.toHaveBeenCalled();
  });
});
