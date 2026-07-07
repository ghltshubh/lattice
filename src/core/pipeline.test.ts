import { describe, expect, it } from "vitest";
import { sanitizeTitle } from "./pipeline";

describe("sanitizeTitle", () => {
  it("strips wrapping quotes, markdown, and trailing punctuation", () => {
    expect(sanitizeTitle('"Marie Curie: A Life in Science."')).toBe(
      "Marie Curie: A Life in Science",
    );
    expect(sanitizeTitle("**The Radium Papers**")).toBe("The Radium Papers");
  });

  it("keeps only the first non-empty line", () => {
    expect(sanitizeTitle("\n\nTitle Here\nSecond line of commentary")).toBe("Title Here");
  });

  it("caps length at 80 characters", () => {
    expect(sanitizeTitle("x".repeat(200))?.length).toBe(80);
  });

  it("returns undefined for empty or all-noise replies", () => {
    expect(sanitizeTitle("")).toBeUndefined();
    expect(sanitizeTitle('""\n')).toBeUndefined();
  });
});
