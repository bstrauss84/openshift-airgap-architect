import React, { useState, useContext } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AppContext } from "../src/store.jsx";
import MethodologyStep from "../src/steps/MethodologyStep.jsx";
import { emptyNode } from "../src/hostInventoryV2Helpers.js";

describe("MethodologyStep placeholder values toggle", () => {
  function StatefulAppContext({ initialState, children }) {
    const [state, setState] = useState(initialState);
    const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));
    return (
      <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
        {children}
      </AppContext.Provider>
    );
  }

  function Probe() {
    const { state } = useContext(AppContext);
    return (
      <div>
        <div data-testid="placeholder-enabled">{String(Boolean(state.ui?.placeholderValuesEnabled))}</div>
        <div data-testid="rootDevice">{state.hostInventory?.nodes?.[0]?.rootDevice || ""}</div>
        <div data-testid="apiVip">{state.hostInventory?.apiVip || ""}</div>
      </div>
    );
  }

  it("flips ON/OFF and applies/clears placeholder values", async () => {
    const initialState = {
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" },
      hostInventory: {
        enableIpv6: false,
        nodes: [
          {
            ...emptyNode("master", 0),
            role: "master",
            hostname: "",
            rootDevice: "",
            dnsServers: "",
            dnsSearch: "",
            bmc: { address: "", username: "", password: "", bootMACAddress: "" },
            primary: {
              ...emptyNode("master", 0).primary,
              ethernet: { ...emptyNode("master", 0).primary.ethernet, macAddress: "" },
              ipv4Cidr: "",
              ipv4Gateway: ""
            }
          }
        ],
        apiVip: "",
        ingressVip: ""
      },
      ui: {
        placeholderValuesEnabled: false,
        visitedSteps: { methodology: true },
        activeStepId: "methodology"
      },
      reviewFlags: {}
    };

    const { container } = render(
      <StatefulAppContext initialState={initialState}>
        <Probe />
        <MethodologyStep />
      </StatefulAppContext>
    );

    // Toggle is a switch input.
    const toggle = screen.getByRole("switch", {
      name: /Enable placeholder values for sensitive environment-specific fields/i
    });
    expect(toggle).toHaveAttribute("aria-label");

    expect(screen.getByTestId("placeholder-enabled").textContent).toBe("false");
    expect(screen.getByTestId("rootDevice").textContent).toBe("");
    expect(screen.getByTestId("apiVip").textContent).toBe("");

    // ON
    fireEvent.click(toggle);

    await waitFor(() => {
      // Switch should now be checked.
      expect(toggle).toBeChecked();
      expect(screen.getByTestId("placeholder-enabled").textContent).toBe("true");
      expect(screen.getByTestId("rootDevice").textContent).toMatch(/^\/dev\/disk\/by-id\/placeholder-disk-/);
      expect(screen.getByTestId("apiVip").textContent).toBe("192.0.2.10");
    });

    // OFF again clears placeholders.
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
      expect(screen.getByTestId("placeholder-enabled").textContent).toBe("false");
      expect(screen.getByTestId("rootDevice").textContent).toBe("");
      expect(screen.getByTestId("apiVip").textContent).toBe("");
    });
  });
});

