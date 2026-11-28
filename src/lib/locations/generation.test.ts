import { describe, expect, it } from "vitest";
import { expandLocationRange, generatedLocationCode, locationCombinations } from "./generation";

describe("location generation ranges", () => {
  it("expands alphabetic and padded numeric ranges", () => {
    expect(expandLocationRange("a", "C")).toEqual(["A", "B", "C"]);
    expect(expandLocationRange("01", "10")).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
  });
  it.each([["C", "A"], ["1", "A"], ["AA", "AC"], ["-1", "2"], ["1", "2001"], ["9007199254740992", "9007199254740993"]])("rejects invalid range %s–%s", (start, end) => {
    expect(expandLocationRange(start, end)).toBeNull();
  });
  it("returns the Cartesian product within the limit", () => {
    expect(locationCombinations([["A", "B"], ["01", "02"]])).toEqual([["A", "01"], ["A", "02"], ["B", "01"], ["B", "02"]]);
    expect(locationCombinations([Array(40).fill("A"), Array(51).fill("1")])).toBeNull();
    expect(locationCombinations([Array(40).fill("A"), Array(50).fill("1")])).toHaveLength(2000);
    expect(locationCombinations([])).toBeNull();
  });
  it("generates valid deterministic codes even when inputs are long", () => {
    expect(generatedLocationCode("DEP-01", ["A", "01"])).toBe("G-DEP-01-A-01");
    const code = generatedLocationCode("A".repeat(40), ["01", "02", "03", "04"]);
    expect(code).toMatch(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
    expect(generatedLocationCode("A".repeat(40), ["01", "02", "03", "04"])).toBe(code);
    expect(generatedLocationCode("A".repeat(40), ["01", "02", "03", "05"])).not.toBe(code);
  });
});
