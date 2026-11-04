/**
 * F19 (v2.2.0 M5) — the Install lock must confirm the selection on screen.
 *
 * /api/operators/confirm locks the release the SERVER holds, and the wizard
 * saves through a 600 ms debounce. Locking inside that window confirmed an
 * older — possibly empty — release and then adopted the server's reply,
 * replacing the selection on screen; the next save was refused (400 "Release
 * cannot be confirmed without a channel") and generation failed (422).
 *
 * The lock now flushes the pending save first, never locks when that save
 * failed, and reports a refused lock instead of dropping it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

const unlocked = {
  blueprint: { arch: "x86_64", platform: "Bare Metal", confirmed: false, confirmationTimestamp: null },
  release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false },
  version: { _schemaVersion: 3, selectedMinor: "4.20", selectedPatch: "4.20.0", selectedChannel: "stable-4.20", selectedVersion: "4.20.0", locked: false },
  methodology: { method: "Agent-Based Installer" },
  operators: {},
  ui: { activeStepId: "blueprint", visitedSteps: { blueprint: true }, completedSteps: {} }
};

const lockedReply = {
  ok: true,
  release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true },
  version: { _schemaVersion: 3, selectedMinor: "4.20", selectedPatch: "4.20.0", selectedChannel: "stable-4.20", selectedVersion: "4.20.0", locked: true, confirmedByUser: true }
};

const httpError = (status, message) => Object.assign(new Error(message), { status, payload: { error: message } });

/** Base mock; `post` handles POST /api/state, `confirm` handles the lock. */
const mockApi = ({ post, confirm }) => {
  vi.mocked(apiFetch).mockImplementation((path, opts) => {
    if (path === "/api/state" && opts?.method === "POST") return post(opts);
    if (path === "/api/state") return Promise.resolve(structuredClone(unlocked));
    if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.20"] });
    if (String(path).startsWith("/api/cincinnati/patches")) return Promise.resolve({ versions: ["4.20.0"] });
    if (path === "/api/operators/confirm") return confirm();
    return Promise.resolve({});
  });
};

const openLockModal = async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Continue install/i }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /Blueprint/i }).length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole("button", { name: /Blueprint/i })[0]);
  await waitFor(() => expect(screen.getByRole("heading", { name: /Foundational selections/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Confirm & Proceed/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Yes, lock selections/i })).toBeEnabled());
};

const confirmCalls = () => vi.mocked(apiFetch).mock.calls.filter((c) => c[0] === "/api/operators/confirm");

describe("F19 — Install lock confirms only what the server has saved", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("does not lock when the selection could not be saved, and says so", async () => {
    mockApi({ post: () => Promise.reject(httpError(503, "Service unavailable")), confirm: () => Promise.resolve(lockedReply) });
    await openLockModal();
    fireEvent.click(screen.getByRole("button", { name: /Yes, lock selections/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be saved to the server/);
    expect(alert.textContent).toMatch(/nothing was locked/i);
    expect(confirmCalls()).toHaveLength(0);
  });

  it("reports a refused lock (409) and stays on the dialog", async () => {
    mockApi({
      post: () => Promise.resolve({ ok: true }),
      confirm: () => Promise.reject(httpError(409, "Select an OpenShift release and patch before locking."))
    });
    await openLockModal();
    fireEvent.click(screen.getByRole("button", { name: /Yes, lock selections/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Select an OpenShift release and patch before locking\. Nothing was locked\./);
    expect(screen.getByRole("button", { name: /Yes, lock selections/i })).toBeInTheDocument();
  });

  it("locks only after every save issued before it has completed", async () => {
    let outstanding = 0;
    let saves = 0;
    const violations = [];
    mockApi({
      post: () => {
        outstanding += 1;
        saves += 1;
        return new Promise((resolve) => setTimeout(() => { outstanding -= 1; resolve({ ok: true }); }, 40));
      },
      confirm: () => {
        if (outstanding > 0) violations.push(`confirm while ${outstanding} save(s) in flight`);
        if (saves === 0) violations.push("confirm before any save");
        return Promise.resolve(lockedReply);
      }
    });
    await openLockModal();
    fireEvent.click(screen.getByRole("button", { name: /Yes, lock selections/i }));
    await waitFor(() => expect(confirmCalls()).toHaveLength(1));
    expect(violations).toEqual([]);
  });
});
