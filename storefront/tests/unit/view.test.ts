import { describe, expect, it } from "vitest";
import { formatPrice } from "../../src/view.js";

/**
 * A starting point, not a suggestion about where your tests belong.
 * Delete it if it is in the way.
 */
describe("formatPrice", () => {
  it("renders minor units as a decimal amount", () => {
    expect(formatPrice(499, "EUR")).toBe("€4.99");
  });
});
