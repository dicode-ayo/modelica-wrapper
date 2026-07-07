import { describe, expect, it } from "vitest";

import { parseCssColor } from "../src/connection/parse-color.js";

describe("parseCssColor", () => {
  it("parses the rgb(r,g,b) form colorToCss emits", () => {
    expect(parseCssColor("rgb(0,0,127)")).toBe(0x00007f);
    expect(parseCssColor("rgb(255,16,0)")).toBe(0xff1000);
    expect(parseCssColor("rgb(255,255,255)")).toBe(0xffffff);
  });

  it("tolerates whitespace between rgb channels", () => {
    expect(parseCssColor("rgb( 0 , 0 , 127 )")).toBe(0x00007f);
  });

  it("still parses the #rrggbb and bare-hex forms", () => {
    expect(parseCssColor("#00007f")).toBe(0x00007f);
    expect(parseCssColor("00007f")).toBe(0x00007f);
    expect(parseCssColor("#FF1000")).toBe(0xff1000);
  });

  it("returns undefined for empty, malformed, or out-of-range input", () => {
    expect(parseCssColor(undefined)).toBeUndefined();
    expect(parseCssColor("")).toBeUndefined();
    expect(parseCssColor("rgb(0,0)")).toBeUndefined();
    expect(parseCssColor("rgb(300,0,0)")).toBeUndefined();
    expect(parseCssColor("rgba(0,0,0,1)")).toBeUndefined();
    expect(parseCssColor("#fff")).toBeUndefined();
  });
});
