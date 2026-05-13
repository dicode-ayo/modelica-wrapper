/**
 * Cross-pipeline mutex shared by the user-triggered `modelica.checkModel`
 * command and the debounced live-check pipeline. OMC itself is already
 * single-threaded and `OmcClient` serializes calls, but the lock has two
 * extra responsibilities our user-facing flows depend on:
 *
 *   1. Suspend auto-checks while the user runs Check Model — so the
 *      "global refresh" can clear+replace diagnostics without an in-flight
 *      live check overwriting them mid-run.
 *
 *   2. Keep the operations atomic w.r.t. the OMC error buffer — drain →
 *      run → read → diagnostic-collection update happens without
 *      interleaved diagnostic reads from another pipeline.
 *
 * Single-token chain-of-promises mutex. Cheap to inline, but pulling it
 * into its own module avoids a circular import between live-check and
 * check-model.
 */

class CheckLock {
  private chain: Promise<unknown> = Promise.resolve();

  /** Run `fn` exclusively. Errors propagate to the caller; the lock releases either way. */
  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }
}

export const liveCheckLock = new CheckLock();
