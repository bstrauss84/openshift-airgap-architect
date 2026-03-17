import { describe, it, expect } from "vitest";
import { sortChannelsBySemverAscending, getNewestChannel } from "../src/shared/cincinnatiChannels.js";

describe("cincinnatiChannels", () => {
  describe("sortChannelsBySemverAscending", () => {
    it("sorts channels ascending by major then minor", () => {
      expect(sortChannelsBySemverAscending(["4.21", "4.17", "4.20"])).toEqual(["4.17", "4.20", "4.21"]);
    });
    it("handles backend descending order (newest first) by producing ascending", () => {
      const backendOrder = ["4.21", "4.20", "4.19", "4.18"];
      expect(sortChannelsBySemverAscending(backendOrder)).toEqual(["4.18", "4.19", "4.20", "4.21"]);
    });
    it("handles mock order (e.g. 4.20, 4.19, 4.18) by producing ascending", () => {
      expect(sortChannelsBySemverAscending(["4.20", "4.19", "4.18"])).toEqual(["4.18", "4.19", "4.20"]);
    });
    it("does not mutate input", () => {
      const input = ["4.20", "4.18"];
      sortChannelsBySemverAscending(input);
      expect(input).toEqual(["4.20", "4.18"]);
    });
  });

  describe("getNewestChannel", () => {
    it("returns newest channel regardless of input order", () => {
      expect(getNewestChannel(["4.20", "4.19", "4.18"])).toBe("4.20");
      expect(getNewestChannel(["4.18", "4.21", "4.17"])).toBe("4.21");
    });
    it("returns single channel", () => {
      expect(getNewestChannel(["4.20"])).toBe("4.20");
    });
    it("returns null for empty", () => {
      expect(getNewestChannel([])).toBe(null);
      expect(getNewestChannel(null)).toBe(null);
    });
  });
});
