/**
 * Regression tests: AWS GovCloud scenarios filter the regions list to only
 * us-gov-* regions, even when the API returns mixed commercial + GovCloud
 * regions. Non-GovCloud AWS scenarios retain all regions.
 */
import { describe, it, expect } from "vitest";

const MIXED_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "us-gov-east-1",
  "us-gov-west-1",
  "ap-southeast-1",
];

const GOV_ONLY = ["us-gov-east-1", "us-gov-west-1"];

function filterRegions(allRegions, scenarioId) {
  const isGovCloud =
    scenarioId === "aws-govcloud-ipi" || scenarioId === "aws-govcloud-upi";
  return isGovCloud ? allRegions.filter((r) => r.startsWith("us-gov-")) : allRegions;
}

describe("GovCloud region filtering", () => {
  it("aws-govcloud-ipi filters to only us-gov-* regions", () => {
    const result = filterRegions(MIXED_REGIONS, "aws-govcloud-ipi");
    expect(result).toEqual(GOV_ONLY);
  });

  it("aws-govcloud-upi filters to only us-gov-* regions", () => {
    const result = filterRegions(MIXED_REGIONS, "aws-govcloud-upi");
    expect(result).toEqual(GOV_ONLY);
  });

  it("non-GovCloud scenario retains all regions", () => {
    const result = filterRegions(MIXED_REGIONS, "aws-commercial-ipi");
    expect(result).toEqual(MIXED_REGIONS);
  });

  it("null scenarioId retains all regions", () => {
    const result = filterRegions(MIXED_REGIONS, null);
    expect(result).toEqual(MIXED_REGIONS);
  });

  it("empty region list returns empty for GovCloud", () => {
    const result = filterRegions([], "aws-govcloud-ipi");
    expect(result).toEqual([]);
  });

  it("all-commercial list returns empty for GovCloud", () => {
    const commercial = ["us-east-1", "us-west-2", "eu-west-1"];
    const result = filterRegions(commercial, "aws-govcloud-ipi");
    expect(result).toEqual([]);
  });

  it("all-govcloud list is unchanged for GovCloud scenario", () => {
    const result = filterRegions(GOV_ONLY, "aws-govcloud-ipi");
    expect(result).toEqual(GOV_ONLY);
  });
});
