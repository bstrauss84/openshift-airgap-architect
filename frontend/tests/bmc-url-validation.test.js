/**
 * BMC URL Validation Tests
 *
 * Tests validation of BMC (Baseboard Management Controller) URLs used in
 * bare-metal deployments for out-of-band management.
 *
 * Tests cover:
 * - Valid BMC URL formats (redfish, idrac, ipmi, ilo, etc.)
 * - Invalid formats (missing protocol, malformed URLs, etc.)
 * - IPI method (BMC address required, format validated)
 * - Agent method (BMC address optional, format validated if provided)
 */

import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";

describe("BMC URL Validation", () => {
  const baseBareMetalIPIState = {
    blueprint: { platform: "Bare Metal" },
    methodology: { method: "IPI" },
    hostInventory: {
      nodes: []
    }
  };

  const baseBareMetalAgentState = {
    blueprint: { platform: "Bare Metal" },
    methodology: { method: "Agent-Based Installer" },
    hostInventory: {
      nodes: []
    }
  };

  describe("Valid BMC URL formats", () => {
    const validUrls = [
      "redfish+https://192.168.1.1/redfish/v1",
      "redfish+http://192.168.1.1/redfish/v1/Systems/1",
      "redfish://10.0.0.1",
      "redfish-virtualmedia+https://bmc.example.com/redfish/v1",
      "redfish-virtualmedia+http://bmc.example.com:8000/redfish/v1",
      "ipmi://192.168.1.100",
      "ipmi://bmc.local.domain",
      "ipmi://[2001:db8::1]", // IPv6 in brackets
      "idrac+https://idrac.example.com",
      "idrac+http://10.0.0.50",
      "idrac://192.168.1.50",
      "idrac-virtualmedia+https://idrac.dell.com",
      "idrac-virtualmedia+http://10.0.0.51",
      "idrac-virtualmedia://192.168.1.51",
      "ilo4-virtualmedia://ilo.hpe.com",
      "ilo5-virtualmedia://10.0.0.60"
    ];

    validUrls.forEach((url) => {
      it(`accepts valid BMC URL: ${url}`, () => {
        const state = {
          ...baseBareMetalIPIState,
          hostInventory: {
            nodes: [
              {
                hostname: "master-0",
                role: "master",
                bmc: {
                  address: url,
                  username: "admin",
                  password: "password",
                  bootMACAddress: "52:54:00:6b:34:56"
                }
              }
            ]
          }
        };

        const result = validateStep(state, "inventory");
        const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
        expect(bmcErrors).toHaveLength(0);
      });
    });
  });

  describe("Invalid BMC URL formats", () => {
    const invalidUrlTestCases = [
      {
        url: "192.168.1.1",
        description: "plain IP without protocol"
      },
      {
        url: "http://192.168.1.1",
        description: "generic HTTP (not BMC protocol)"
      },
      {
        url: "https://192.168.1.1",
        description: "generic HTTPS (not BMC protocol)"
      },
      {
        url: "bmc.example.com",
        description: "hostname without protocol"
      },
      {
        url: "redfish://",
        description: "protocol without host"
      },
      {
        url: "redfish:///path",
        description: "protocol with path but no host"
      },
      {
        url: "not-a-valid-protocol://192.168.1.1",
        description: "unsupported protocol"
      },
      {
        url: "redfish+ftp://192.168.1.1",
        description: "redfish with invalid transport (ftp)"
      },
      // Note: empty string is handled separately (required vs optional)
    ];

    invalidUrlTestCases.forEach(({ url, description }) => {
      it(`rejects invalid BMC URL (IPI): ${description}`, () => {
        const state = {
          ...baseBareMetalIPIState,
          hostInventory: {
            nodes: [
              {
                hostname: "master-0",
                role: "master",
                bmc: {
                  address: url,
                  username: "admin",
                  password: "password",
                  bootMACAddress: "52:54:00:6b:34:56"
                }
              }
            ]
          }
        };

        const result = validateStep(state, "inventory");
        const bmcErrors = result.errors.filter((e) =>
          e.includes("BMC address") && e.includes("valid URL")
        );
        expect(bmcErrors.length).toBeGreaterThan(0);
        expect(bmcErrors[0]).toContain("BMC address must be a valid URL");
      });

      it(`warns invalid BMC URL (Agent): ${description}`, () => {
        const state = {
          ...baseBareMetalAgentState,
          hostInventory: {
            nodes: [
              {
                hostname: "master-0",
                role: "master",
                bmc: {
                  address: url
                }
              }
            ]
          }
        };

        const result = validateStep(state, "inventory");
        const bmcWarnings = result.warnings.filter((w) =>
          w.includes("BMC address") && w.includes("format is invalid")
        );
        expect(bmcWarnings.length).toBeGreaterThan(0);
        expect(bmcWarnings[0]).toContain("BMC address format is invalid");
      });
    });
  });

  describe("IPI method BMC validation", () => {
    it("requires BMC address for IPI nodes", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {} // No address
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) =>
        e.includes("BMC address") && e.includes("required")
      );
      expect(bmcErrors.length).toBeGreaterThan(0);
      expect(bmcErrors[0]).toContain("BMC address is required");
    });

    it("validates BMC address format for IPI nodes", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "just-a-hostname",
                username: "admin",
                password: "password",
                bootMACAddress: "52:54:00:6b:34:56"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) =>
        e.includes("BMC address") && e.includes("valid URL")
      );
      expect(bmcErrors.length).toBeGreaterThan(0);
    });

    it("accepts valid BMC address for IPI nodes", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "redfish+https://192.168.1.1/redfish/v1",
                username: "admin",
                password: "password",
                bootMACAddress: "52:54:00:6b:34:56"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
      expect(bmcErrors).toHaveLength(0);
    });
  });

  describe("Agent method BMC validation", () => {
    it("does not require BMC address for Agent nodes", () => {
      const state = {
        ...baseBareMetalAgentState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {} // No address - should be OK for Agent
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
      expect(bmcErrors).toHaveLength(0); // No errors for missing BMC in Agent method
    });

    it("warns about invalid BMC address format for Agent nodes if provided", () => {
      const state = {
        ...baseBareMetalAgentState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "192.168.1.1" // Plain IP without protocol
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcWarnings = result.warnings.filter((w) =>
        w.includes("BMC address") && w.includes("format is invalid")
      );
      expect(bmcWarnings.length).toBeGreaterThan(0);
    });

    it("does not warn about valid BMC address for Agent nodes", () => {
      const state = {
        ...baseBareMetalAgentState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "redfish+https://192.168.1.1/redfish/v1",
                username: "admin",
                password: "password"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcWarnings = result.warnings.filter((w) => w.includes("BMC address"));
      expect(bmcWarnings).toHaveLength(0);
    });
  });

  describe("Empty string handling", () => {
    it("treats empty string as missing BMC address for IPI (required error)", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "", // Empty string
                username: "admin",
                password: "password",
                bootMACAddress: "52:54:00:6b:34:56"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) =>
        e.includes("BMC address") && e.includes("required")
      );
      expect(bmcErrors.length).toBeGreaterThan(0);
      expect(bmcErrors[0]).toContain("BMC address is required");
    });

    it("does not error on empty BMC address for Agent (optional)", () => {
      const state = {
        ...baseBareMetalAgentState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "" // Empty string - should be OK for Agent
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
      const bmcWarnings = result.warnings.filter((w) => w.includes("BMC address"));
      expect(bmcErrors).toHaveLength(0);
      expect(bmcWarnings).toHaveLength(0); // Empty string is fine for optional field
    });
  });

  describe("Edge cases", () => {
    it("handles whitespace in BMC URLs", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "  redfish+https://192.168.1.1/redfish/v1  ", // Leading/trailing spaces
                username: "admin",
                password: "password",
                bootMACAddress: "52:54:00:6b:34:56"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
      expect(bmcErrors).toHaveLength(0); // Should trim and validate
    });

    it("handles IPv6 BMC addresses in brackets", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "redfish+https://[2001:db8::1]/redfish/v1",
                username: "admin",
                password: "password",
                bootMACAddress: "52:54:00:6b:34:56"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
      expect(bmcErrors).toHaveLength(0);
    });

    it("handles BMC URLs with ports", () => {
      const state = {
        ...baseBareMetalIPIState,
        hostInventory: {
          nodes: [
            {
              hostname: "master-0",
              role: "master",
              bmc: {
                address: "redfish+https://192.168.1.1:8443/redfish/v1",
                username: "admin",
                password: "password",
                bootMACAddress: "52:54:00:6b:34:56"
              }
            }
          ]
        }
      };

      const result = validateStep(state, "inventory");
      const bmcErrors = result.errors.filter((e) => e.includes("BMC address"));
      expect(bmcErrors).toHaveLength(0);
    });
  });
});
