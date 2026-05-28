/**
 * Regression Tests for v1.7.0
 *
 * Tests to prevent recurrence of regressions found during v1.7.0 release:
 * 1. Version display showing incorrect hardcoded value
 * 2. Feedback button missing from header
 * 3. Assets & Guide tab showing "Needs review" badge
 * 4. IP address fields not showing inline validation errors
 *
 * Created: 2026-05-28
 * Author: Bill Strauss
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import AboutModal from "../src/components/AboutModal.jsx";
import Sidebar from "../src/components/Sidebar.jsx";
import { NodeDrawerIpiContent } from "../src/components/NodeDrawerIpiContent.jsx";

describe("Regression Tests - v1.7.0", () => {
  describe("Version Display Regression", () => {
    it("should use appVersion prop instead of hardcoded '1.1.0'", () => {
      const { container } = render(
        <AboutModal
          isOpen={true}
          onClose={() => {}}
          appVersion="1.7.0"
          gitSha="abc1234"
          buildTime="2026-05-28T12:00:00Z"
        />
      );

      const versionText = container.textContent;
      expect(versionText).toContain("1.7.0");
      expect(versionText).not.toContain("1.1.0");
    });

    it("should handle missing appVersion with sensible fallback", () => {
      const { container } = render(
        <AboutModal
          isOpen={true}
          onClose={() => {}}
          appVersion={null}
          gitSha="abc1234"
          buildTime="2026-05-28T12:00:00Z"
        />
      );

      const versionText = container.textContent;
      // Should show dev fallback, not hardcoded 1.1.0
      expect(versionText).toContain("1.7.0-dev");
      expect(versionText).not.toContain("1.1.0");
    });

    it("should handle 'unknown' buildTime without showing 'Invalid Date'", () => {
      const { container } = render(
        <AboutModal
          isOpen={true}
          onClose={() => {}}
          appVersion="1.7.0"
          gitSha="abc1234"
          buildTime="unknown"
        />
      );

      const text = container.textContent;
      expect(text).not.toContain("Invalid Date");
      expect(text).toContain("dev build"); // Fallback text
    });

    it("should handle 'unknown' gitSha gracefully", () => {
      const { container } = render(
        <AboutModal
          isOpen={true}
          onClose={() => {}}
          appVersion="1.7.0"
          gitSha="unknown"
          buildTime="2026-05-28T12:00:00Z"
        />
      );

      const text = container.textContent;
      expect(text).toContain("dev"); // Falls back to "dev" for unknown SHA
      expect(text).not.toContain("unknown");
    });

    it("should format valid buildTime as localized date", () => {
      const { container } = render(
        <AboutModal
          isOpen={true}
          onClose={() => {}}
          appVersion="1.7.0"
          gitSha="abc1234"
          buildTime="2026-05-28T12:00:00Z"
        />
      );

      const text = container.textContent;
      // Should contain a formatted date (exact format depends on locale)
      expect(text).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/); // Matches common date formats
    });
  });

  describe("Assets & Guide Badge Regression", () => {
    const mockSteps = [
      { stepNumber: 1, id: "blueprint", label: "Blueprint" },
      { stepNumber: 2, id: "methodology", label: "Methodology" },
      { stepNumber: 3, id: "identity", label: "Identity & Access" },
      { stepNumber: 6, id: "review", label: "Assets & Guide" },
      { stepNumber: 7, id: "run-oc-mirror", label: "Run oc-mirror" },
      { stepNumber: 8, id: "operations", label: "Operations" }
    ];

    it("should NOT show 'Needs review' badge on Assets & Guide tab", () => {
      render(
        <Sidebar
          steps={mockSteps}
          activeStepId="blueprint"
          onStepClick={() => {}}
          sidebarOpen={true}
          setSidebarOpen={() => {}}
          completeFlags={{}}
          visitedSteps={{ review: true }}
          reviewFlags={{ review: true }} // This would trigger "Needs review" if not excluded
          errorFlags={{}}
          foundationalLocked={true}
          lockToast=""
          setLockToast={() => {}}
        />
      );

      const assetsGuideButton = screen.getByRole("button", { name: /Assets & Guide/i });

      // Should NOT contain "Needs review" badge
      expect(assetsGuideButton.textContent).not.toContain("Needs review");
    });

    it("should NOT show checkmark on Assets & Guide tab", () => {
      render(
        <Sidebar
          steps={mockSteps}
          activeStepId="blueprint"
          onStepClick={() => {}}
          sidebarOpen={true}
          setSidebarOpen={() => {}}
          completeFlags={{ review: true }} // Even if marked complete, shouldn't show checkmark
          visitedSteps={{}}
          reviewFlags={{}}
          errorFlags={{}}
          foundationalLocked={true}
          lockToast=""
          setLockToast={() => {}}
        />
      );

      const assetsGuideButton = screen.getByRole("button", { name: /Assets & Guide/i });

      // Should NOT contain checkmark (✓)
      expect(assetsGuideButton.textContent).not.toContain("✓");
    });

    it("should NOT show 'Needs review' on Operations tab either", () => {
      render(
        <Sidebar
          steps={mockSteps}
          activeStepId="blueprint"
          onStepClick={() => {}}
          sidebarOpen={true}
          setSidebarOpen={() => {}}
          completeFlags={{}}
          visitedSteps={{ operations: true }}
          reviewFlags={{ operations: true }}
          errorFlags={{}}
          foundationalLocked={true}
          lockToast=""
          setLockToast={() => {}}
        />
      );

      const operationsButton = screen.getByRole("button", { name: /Operations/i });
      expect(operationsButton.textContent).not.toContain("Needs review");
    });

    it("should NOT show 'Needs review' on Run oc-mirror tab", () => {
      render(
        <Sidebar
          steps={mockSteps}
          activeStepId="blueprint"
          onStepClick={() => {}}
          sidebarOpen={true}
          setSidebarOpen={() => {}}
          completeFlags={{}}
          visitedSteps={{ "run-oc-mirror": true }}
          reviewFlags={{ "run-oc-mirror": true }}
          errorFlags={{}}
          foundationalLocked={true}
          lockToast=""
          setLockToast={() => {}}
        />
      );

      const runMirrorButton = screen.getByRole("button", { name: /Run oc-mirror/i });
      expect(runMirrorButton.textContent).not.toContain("Needs review");
    });

    it("SHOULD show 'Needs review' on configuration tabs like Identity & Access", () => {
      render(
        <Sidebar
          steps={mockSteps}
          activeStepId="blueprint"
          onStepClick={() => {}}
          sidebarOpen={true}
          setSidebarOpen={() => {}}
          completeFlags={{}}
          visitedSteps={{ identity: true }}
          reviewFlags={{ identity: true }}
          errorFlags={{}}
          foundationalLocked={true}
          lockToast=""
          setLockToast={() => {}}
        />
      );

      const identityButton = screen.getByRole("button", { name: /Identity & Access/i });

      // Configuration tabs SHOULD show "Needs review"
      expect(identityButton.textContent).toContain("Needs review");
    });
  });

  describe("IP Address Field Validation Display Regression", () => {
    const mockNode = {
      role: "worker",
      hostname: "worker-0",
      networkConfig: {
        primaryInterface: {
          ip: "12341551112312", // Invalid CIDR
          gateway: "19212341324", // Invalid IP
          dns: "8.8.8.8"
        }
      }
    };

    const mockValidationWithErrors = {
      0: {
        fieldErrors: {
          "networkConfig.primaryInterface.ip": "IP address must be in CIDR format (e.g., 192.168.1.10/24)",
          "networkConfig.primaryInterface.gateway": "Gateway must be valid IPv4 address"
        }
      }
    };

    const mockValidationNoErrors = {
      0: { fieldErrors: {} }
    };

    it("should show red border (input-error class) on IP Address field when invalid", () => {
      const { container } = render(
        <NodeDrawerIpiContent
          node={mockNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationWithErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[mockNode]}
        />
      );

      const ipInput = container.querySelector('input[placeholder="192.168.1.10/24"]');
      expect(ipInput).toBeTruthy();
      expect(ipInput.className).toContain("input-error");
    });

    it("should show inline error message below IP Address field", () => {
      const { container } = render(
        <NodeDrawerIpiContent
          node={mockNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationWithErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[mockNode]}
        />
      );

      const errorSpans = container.querySelectorAll('span.note.warning.inline');
      const ipErrorSpan = Array.from(errorSpans).find(span =>
        span.textContent.includes("IP address must be in CIDR format")
      );

      expect(ipErrorSpan).toBeTruthy();
      expect(ipErrorSpan.textContent).toContain("e.g., 192.168.1.10/24");
    });

    it("should show red border (input-error class) on Gateway field when invalid", () => {
      const { container } = render(
        <NodeDrawerIpiContent
          node={mockNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationWithErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[mockNode]}
        />
      );

      const gatewayInput = container.querySelector('input[placeholder="192.168.1.1"]');
      expect(gatewayInput).toBeTruthy();
      expect(gatewayInput.className).toContain("input-error");
    });

    it("should show inline error message below Gateway field", () => {
      const { container } = render(
        <NodeDrawerIpiContent
          node={mockNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationWithErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[mockNode]}
        />
      );

      const errorSpans = container.querySelectorAll('span.note.warning.inline');
      const gatewayErrorSpan = Array.from(errorSpans).find(span =>
        span.textContent.includes("Gateway must be valid IPv4 address")
      );

      expect(gatewayErrorSpan).toBeTruthy();
    });

    it("should NOT show error styling when fields are valid", () => {
      const validNode = {
        ...mockNode,
        networkConfig: {
          primaryInterface: {
            ip: "192.168.1.10/24",
            gateway: "192.168.1.1",
            dns: "8.8.8.8"
          }
        }
      };

      const { container } = render(
        <NodeDrawerIpiContent
          node={validNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationNoErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[validNode]}
        />
      );

      const ipInput = container.querySelector('input[placeholder="192.168.1.10/24"]');
      const gatewayInput = container.querySelector('input[placeholder="192.168.1.1"]');

      expect(ipInput.className).not.toContain("input-error");
      expect(gatewayInput.className).not.toContain("input-error");

      const errorSpans = container.querySelectorAll('span.note.warning.inline');
      expect(errorSpans.length).toBe(0);
    });

    it("should set aria-invalid=true on invalid IP fields for accessibility", () => {
      const { container } = render(
        <NodeDrawerIpiContent
          node={mockNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationWithErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[mockNode]}
        />
      );

      const ipInput = container.querySelector('input[placeholder="192.168.1.10/24"]');
      const gatewayInput = container.querySelector('input[placeholder="192.168.1.1"]');

      expect(ipInput.getAttribute("aria-invalid")).toBe("true");
      expect(gatewayInput.getAttribute("aria-invalid")).toBe("true");
    });

    it("should set title attribute on invalid fields for tooltip", () => {
      const { container } = render(
        <NodeDrawerIpiContent
          node={mockNode}
          updateNode={() => {}}
          selectedIndex={0}
          mergedNodeValidation={mockValidationWithErrors}
          roleOptions={[{ value: "worker", label: "Worker" }]}
          roleMeta={{ required: true }}
          formatMACAsYouType={(val) => val}
          normalizeMAC={(val) => val}
          isDefaultHostname={() => false}
          getDefaultHostnameForRole={() => "worker-0"}
          nodes={[mockNode]}
        />
      );

      const ipInput = container.querySelector('input[placeholder="192.168.1.10/24"]');
      const gatewayInput = container.querySelector('input[placeholder="192.168.1.1"]');

      expect(ipInput.title).toContain("IP address must be in CIDR format");
      expect(gatewayInput.title).toContain("Gateway must be valid IPv4 address");
    });
  });
});
