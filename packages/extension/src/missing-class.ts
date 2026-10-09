import * as vscode from "vscode";

import { ModelInstanceNotFoundError } from "@dicode/omc-client";
import { enclosingScope } from "@dicode/modelica-lang-core";

import { renderPlaceholderPage } from "./webview/webview-page.js";

/** The class-set changes that can bring a missing class back. */
export interface ClassSetEvents {
  register(listener: (className: string) => void): vscode.Disposable;
  registerAllClassesChanged(listener: () => void): vscode.Disposable;
}

/** What an editor does when its class is fetched, and when OMC turns out not to have it. */
export interface MissingClassHandlers {
  fetch(): void;
  showMissing(): void;
}

/** Whether a change announced for `announced` (`null`: any class) can reach `className`. */
function announces(announced: string | null, className: string): boolean {
  if (announced === null) return true;
  for (let scope = className; scope !== ""; scope = enclosingScope(scope)) {
    if (scope === announced) return true;
  }
  return false;
}

const watches = new Set<MissingClassWatch>();

/**
 * Re-fetch every open editor's class that OMC didn't have; returns those
 * classes.
 */
export function retryMissingClasses(): string[] {
  const retried: string[] = [];
  for (const watch of watches) {
    if (watch.retry(null)) retried.push(watch.className);
  }
  return retried;
}

/** Whether `err` is OMC's answer that it has no such class. */
export function isMissingClassError(err: unknown): boolean {
  return err instanceof ModelInstanceNotFoundError;
}

/**
 * Tracks one editor's fetch of a class that OMC may not have (yet): one never
 * saved, or one whose package loads after a restored tab. While the class is
 * missing the editor shows a placeholder, and the watch re-fetches it when the
 * class set changes in a way that can reach it.
 */
export class MissingClassWatch {
  private phase: "idle" | "fetching" | "missing" = "idle";
  // The class set changed while the fetch was in flight, so a not-found answer
  // from it is already out of date.
  private changedWhileFetching = false;
  private readonly subscription: vscode.Disposable;

  constructor(
    readonly className: string,
    private readonly handlers: MissingClassHandlers,
    events?: ClassSetEvents,
  ) {
    this.subscription = vscode.Disposable.from(
      ...(events
        ? [
            events.register((announced) => this.retry(announced)),
            events.registerAllClassesChanged(() => this.retry(null)),
          ]
        : []),
    );
    watches.add(this);
  }

  get missing(): boolean {
    return this.phase === "missing";
  }

  fetch(): void {
    this.phase = "fetching";
    this.changedWhileFetching = false;
    this.handlers.fetch();
  }

  /** The fetch answered with anything but not-found. */
  settled(): void {
    this.phase = "idle";
  }

  /** The fetch answered not-found. */
  notFound(): void {
    if (this.changedWhileFetching) {
      this.fetch();
      return;
    }
    this.phase = "missing";
    this.handlers.showMissing();
  }

  /**
   * Re-fetch the class if it is missing and `announced` (`null`: any class)
   * could have added it. Returns whether it re-fetched.
   */
  retry(announced: string | null): boolean {
    if (!announces(announced, this.className)) return false;
    if (this.phase === "fetching") this.changedWhileFetching = true;
    if (this.phase !== "missing") return false;
    this.fetch();
    return true;
  }

  dispose(): void {
    watches.delete(this);
    this.subscription.dispose();
  }
}

/** Script-free page for an editor whose class OMC doesn't have. */
export function renderMissingClassPage(
  cspSource: string,
  className: string,
): string {
  return renderPlaceholderPage({
    cspSource,
    title: "Class not found",
    message: `OMC has no class named ${className}. It may have been deleted, or created in an earlier session and never saved. If its package isn't loaded yet, this tab shows the class once it is.`,
  });
}
