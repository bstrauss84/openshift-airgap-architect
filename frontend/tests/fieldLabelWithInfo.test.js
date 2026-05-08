/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { splitLabelPrefixAndLastWord } from "../src/components/FieldLabelWithInfo.jsx";

describe("splitLabelPrefixAndLastWord", () => {
  it("returns full string as last when a single token", () => {
    expect(splitLabelPrefixAndLastWord("Boot")).toEqual({ prefix: "", last: "Boot" });
    expect(splitLabelPrefixAndLastWord("  Boot  ")).toEqual({ prefix: "", last: "Boot" });
  });

  it("splits on whitespace into prefix and last word", () => {
    expect(splitLabelPrefixAndLastWord("Compute hyperthreading (optional)")).toEqual({
      prefix: "Compute hyperthreading",
      last: "(optional)"
    });
  });

  it("handles empty label", () => {
    expect(splitLabelPrefixAndLastWord("")).toEqual({ prefix: "", last: "" });
    expect(splitLabelPrefixAndLastWord(null)).toEqual({ prefix: "", last: "" });
  });
});
