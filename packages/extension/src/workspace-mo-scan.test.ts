import { describe, expect, it, vi } from "vitest";

import { createMoFileScanner } from "./workspace-mo-scan.js";

describe("createMoFileScanner", () => {
  it("runs findFiles at most once across concurrent scan() calls", async () => {
    const findFiles = vi.fn(async () => ["A.mo", "B.mo"]);
    const scanner = createMoFileScanner(findFiles);

    const [a, b] = await Promise.all([scanner.scan(), scanner.scan()]);

    expect(findFiles).toHaveBeenCalledTimes(1);
    expect(a).toEqual(["A.mo", "B.mo"]);
    expect(b).toEqual(["A.mo", "B.mo"]);
  });

  it("caches a settled scan across sequential calls", async () => {
    const findFiles = vi.fn(async () => ["A.mo"]);
    const scanner = createMoFileScanner(findFiles);

    await scanner.scan();
    await scanner.scan();

    expect(findFiles).toHaveBeenCalledTimes(1);
  });

  it("re-scans after invalidate()", async () => {
    const findFiles = vi.fn(async () => ["A.mo"]);
    const scanner = createMoFileScanner(findFiles);

    await scanner.scan();
    scanner.invalidate();
    await scanner.scan();

    expect(findFiles).toHaveBeenCalledTimes(2);
  });

  it("retries instead of caching a rejection forever", async () => {
    const findFiles = vi
      .fn()
      .mockRejectedValueOnce(new Error("glob failed"))
      .mockResolvedValueOnce(["A.mo"]);
    const scanner = createMoFileScanner(findFiles);

    await expect(scanner.scan()).rejects.toThrow("glob failed");
    await expect(scanner.scan()).resolves.toEqual(["A.mo"]);
    expect(findFiles).toHaveBeenCalledTimes(2);
  });

  it("does not poison concurrent callers awaiting the same failed scan", async () => {
    const findFiles = vi
      .fn()
      .mockRejectedValueOnce(new Error("glob failed"))
      .mockResolvedValueOnce(["A.mo"]);
    const scanner = createMoFileScanner(findFiles);

    const [first, second] = await Promise.allSettled([
      scanner.scan(),
      scanner.scan(),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    expect(findFiles).toHaveBeenCalledTimes(1);

    await expect(scanner.scan()).resolves.toEqual(["A.mo"]);
  });
});
