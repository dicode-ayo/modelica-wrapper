/**
 * Applies host `layout` pushes to the webview. A push flagged `rejected` asks
 * for the host-shape selection to be cleared, but the host spends the flag on
 * the push it sends: if the webview refuses that push, the forced settle that
 * re-sends the layout arrives without it. The request is therefore kept here
 * until a push is actually adopted.
 */
export class LayoutPushReceiver<
  P extends { layoutVersion: number; rejected?: boolean },
> {
  private clearOwed = false;

  constructor(
    private readonly deps: {
      canApply(): boolean;
      adopt(push: P): void;
      clearShapeSelection(): void;
    },
  ) {}

  receive(push: P): void {
    if (push.rejected === true) this.clearOwed = true;
    if (!this.deps.canApply()) return;
    this.deps.adopt(push);
    if (!this.clearOwed) return;
    this.clearOwed = false;
    this.deps.clearShapeSelection();
  }
}
