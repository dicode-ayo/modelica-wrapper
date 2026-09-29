import { describe, expect, it } from "vitest";

import { roundResultOutput, roundSignificant } from "./result-precision.js";

describe("roundSignificant", () => {
  it("drops the float-repr tail of a sum that does not round-trip", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(roundSignificant(0.1 + 0.2)).toBe(0.3);
    expect(String(roundSignificant(0.00030000000000000003))).toBe("0.0003");
  });

  it("counts significant digits, so a small-magnitude signal survives", () => {
    expect(roundSignificant(1.23456789e-9)).toBe(1.23457e-9);
    expect(roundSignificant(123456.789)).toBe(123457);
  });

  it("keeps zero and non-finite values as they are", () => {
    expect(roundSignificant(0)).toBe(0);
    expect(roundSignificant(Infinity)).toBe(Infinity);
    expect(roundSignificant(NaN)).toBeNaN();
  });
});

describe("roundResultOutput", () => {
  it("rounds every value of every row", () => {
    expect(
      roundResultOutput({
        result: [[0.1 + 0.2, 0.0006000000000000001], [0.0007000000000000001]],
      }),
    ).toEqual({ result: [[0.3, 0.0006], [0.0007]] });
  });

  it("leaves a shape it does not recognise alone", () => {
    const odd = { result: "nope" };
    expect(roundResultOutput(odd)).toBe(odd);
    expect(roundResultOutput(undefined)).toBeUndefined();
  });
});
