import { describe, expect, it } from "vitest";
import { LOCATION_COORDINATES, parseLocationCoordinates } from "./coordinates";

describe("coordinates against the warehouse layout", () => {
  it.each([1, 2, 3, 4])("accepts exactly %i configured levels", (count) => {
    const form = new FormData();
    LOCATION_COORDINATES.slice(0, count).forEach((key, index) => form.set(key, ` ${index + 1} `));
    const coordinates = parseLocationCoordinates(form, count);
    expect(coordinates).not.toBeNull();
    expect(Object.values(coordinates!).slice(count)).toEqual(Array(4 - count).fill(null));
  });
  it("rejects missing or extra values", () => {
    const form = new FormData();
    form.set("aisle", "A");
    form.set("level", "1");
    expect(parseLocationCoordinates(form, 2)).toBeNull();
    expect(parseLocationCoordinates(form, 1)).toBeNull();
  });
});
