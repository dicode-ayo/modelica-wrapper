import { describe, expect, it, vi } from "vitest";

import { LruCache } from "../src/lru-cache.js";

describe("LruCache", () => {
  it("stores and retrieves values", () => {
    const c = new LruCache<string, number>(4);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
    expect(c.get("missing")).toBeUndefined();
  });

  it("reports size", () => {
    const c = new LruCache<string, number>(4);
    expect(c.size).toBe(0);
    c.set("x", 1);
    expect(c.size).toBe(1);
    c.set("y", 2);
    expect(c.size).toBe(2);
  });

  it("does not exceed capacity", () => {
    const c = new LruCache<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4);
    expect(c.size).toBe(3);
  });

  it("evicts the least-recently-used entry on overflow", () => {
    const evicted: string[] = [];
    const c = new LruCache<string, number>(2, (k) => evicted.push(k));
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // "a" is LRU → evicted
    expect(evicted).toEqual(["a"]);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("promotes a read entry so it is not the next eviction victim", () => {
    const evicted: string[] = [];
    const c = new LruCache<string, number>(2, (k) => evicted.push(k));
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // promote "a" — now "b" is LRU
    c.set("c", 3); // "b" should be evicted, not "a"
    expect(evicted).toEqual(["b"]);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });

  it("updating an existing key does not trigger eviction", () => {
    const onEvict = vi.fn();
    const c = new LruCache<string, number>(2, onEvict);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 99); // update — no eviction, size stays 2
    expect(onEvict).not.toHaveBeenCalled();
    expect(c.size).toBe(2);
    expect(c.get("a")).toBe(99);
  });

  it("updating an existing key moves it to the tail", () => {
    const evicted: string[] = [];
    const c = new LruCache<string, number>(2, (k) => evicted.push(k));
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10); // re-insert "a" at tail — "b" is now LRU
    c.set("c", 3); // "b" evicted, not "a"
    expect(evicted).toEqual(["b"]);
    expect(c.get("a")).toBe(10);
  });

  it("delete removes an entry and returns true", () => {
    const c = new LruCache<string, number>(4);
    c.set("a", 1);
    expect(c.delete("a")).toBe(true);
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("delete returns false for a missing key", () => {
    const c = new LruCache<string, number>(4);
    expect(c.delete("nope")).toBe(false);
  });

  it("passes the evicted key and value to onEvict", () => {
    const calls: Array<[string, number]> = [];
    const c = new LruCache<string, number>(1, (k, v) => calls.push([k, v]));
    c.set("a", 42);
    c.set("b", 99); // evicts "a"
    expect(calls).toEqual([["a", 42]]);
  });

  it("clear empties the cache without calling onEvict", () => {
    const onEvict = vi.fn();
    const c = new LruCache<string, number>(4, onEvict);
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(onEvict).not.toHaveBeenCalled();
  });

  it("values() iterates entries in LRU-to-MRU order", () => {
    const c = new LruCache<string, number>(4);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect([...c.values()]).toEqual([1, 2, 3]);
    c.get("a"); // promote "a" to tail
    expect([...c.values()]).toEqual([2, 3, 1]);
  });

  it("works with a capacity of 1", () => {
    const evicted: string[] = [];
    const c = new LruCache<string, number>(1, (k) => evicted.push(k));
    c.set("a", 1);
    c.set("b", 2);
    expect(evicted).toEqual(["a"]);
    expect(c.size).toBe(1);
    expect(c.get("b")).toBe(2);
  });
});
