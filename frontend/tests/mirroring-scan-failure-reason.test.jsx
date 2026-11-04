/**
 * v2.2.0 — Scan Operators P0: a failed scan says why.
 *
 * The Mirroring scan showed only "failed • 100%" per catalog and a banner that
 * claimed "Results shown are from the catalogs that did" even when none did, so
 * a scan refused at once by the backend's proxy looked like a broken button.
 * Install's scan already shows the server's reason; Mirroring now does too.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";
import { scanTiming, _resetScanSessionsForTests, describeScanFailure, scanFailureReason } from "../src/mirroring/useProfileCatalogs.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
beforeEach(() => _resetSourceCredentialsForTests());

/** The mounted pull secret is used only when switched on (FQ-SCAN-1): switch it on when the server has one. */
const armMounted = async () => {
  const sw = await screen.findByRole("switch", { name: /mounted into the container/ }, { timeout: 300 }).catch(() => null);
  if (sw && sw.getAttribute("aria-checked") !== "true") fireEvent.click(sw);
};

const PROXY_REASON = "The HTTPS proxy 127.0.0.1:9 configured for the Architect backend could not be reached (ECONNREFUSED), so registry.redhat.io was not contacted and no credential was sent. Check the backend's HTTPS_PROXY / NO_PROXY settings, or use a machine with access to registry.redhat.io.";
const failedJob = (id, catalog, reason = PROXY_REASON) => ({
  id, status: "failed", progress: 100,
  message: `The ${catalog} catalog could not be fetched and verified: ${reason}`,
  metadata_json: JSON.stringify({ failure: { code: "UNREACHABLE", reason } })
});
let fake;
function api(path) {
  if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: true });
  if (path.startsWith("/api/operators/status")) return Promise.resolve(fake.cache);
  if (path === "/api/operators/scan") {
    const jobs = {};
    for (const c of ["redhat", "certified", "community"]) { jobs[c] = `job-${c}`; fake.jobs[`job-${c}`] = fake.outcome(c); }
    return Promise.resolve({ jobs });
  }
  const m = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (m) return Promise.resolve(fake.jobs[m[1]]);
  return Promise.reject(new Error(`unexpected ${path}`));
}
const profile = {
  id: "p-reason", name: "reason", updatedAt: 1,
  content: { platform: false, operators: true, additionalImages: false },
  platform: { release: {}, version: {} },
  operators: { catalogMinor: "4.22", catalogMinorSource: "user", selected: [] },
  additionalImages: [], paths: {}, catalogReconciliation: null
};
function Host() {
  const [p, setP] = useState(profile);
  return <OperatorsSection profile={p} onProfileChanged={setP} />;
}
const card = (label) => screen.getByText(label, { selector: "strong" }).closest(".scan-status-card");

beforeEach(() => {
  fake = { cache: {}, jobs: {}, outcome: (c) => failedJob(`job-${c}`, c) };
  _resetScanSessionsForTests();
  scanTiming.pollMs = 15;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(api);
});
afterEach(cleanup);

describe("Mirroring scan failure is explained", () => {
  it("every catalog refused for the same reason: the banner says it once, without claiming results", async () => {
    render(<Host />);
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    const banner = await screen.findByText(/^No catalog could be scanned\./);
    expect(banner.textContent).toBe(`No catalog could be scanned. ${PROXY_REASON}`);
    expect(screen.queryByText(/Results shown are from the catalogs that did/)).toBeNull();
    expect(screen.getAllByText(PROXY_REASON, { exact: false })).toHaveLength(1); // said once, not four times
    expect(within(card("Red Hat")).getByText(/failed/)).toBeTruthy();
  });

  it("one catalog failed: the others' results are used and the failed one is named with its reason", async () => {
    fake.outcome = (c) => {
      // Results exist only once the scan has run (an earlier cache would collapse the discovery card).
      fake.cache = { redhat: { results: [{ id: "redhat:a", name: "a", displayName: "Operator A", defaultChannel: "stable", catalog: "redhat" }] } };
      return c === "certified" ? failedJob("job-certified", c, "registry.redhat.io denied access to redhat/certified-operator-index (403).") : { id: `job-${c}`, status: "completed", progress: 100, message: "done" };
    };
    render(<Host />);
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    const banner = await screen.findByText(/^The scan did not complete for: Certified\./);
    expect(banner.textContent).toContain("Results shown are from the catalogs that did.");
    expect(banner.textContent).toContain("denied access to redhat/certified-operator-index (403)");
    expect(within(card("Red Hat")).queryByText(/denied access/)).toBeNull();
  });

  it("different reasons: each catalog card shows its own", async () => {
    fake.outcome = (c) => failedJob(`job-${c}`, c, c === "community" ? "registry.redhat.io refused the credentials (401)." : PROXY_REASON);
    render(<Host />);
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    await screen.findByText("No catalog could be scanned. The reason for each catalog is shown below.");
    expect(within(card("Community")).getByText(/refused the credentials \(401\)/)).toBeTruthy();
    expect(within(card("Red Hat")).getByText(PROXY_REASON)).toBeTruthy();
  });

  it("an older server without failure metadata: the job message is shown; never an empty reason", () => {
    expect(scanFailureReason({ status: "failed", message: "oc-mirror failed to start (redhat): spawn ENOENT" })).toBe("oc-mirror failed to start (redhat): spawn ENOENT");
    expect(scanFailureReason({ status: "failed", message: "" })).toBe("The server reported no reason.");
    expect(scanFailureReason({ status: "failed", message: "x", metadata_json: "{not json" })).toBe("x");
    expect(scanFailureReason({ status: "cancelled", message: "Cancelled" })).toBe("The scan was stopped.");
  });

  it("a refused request shows the field problem, not just \"Validation failed\"", async () => {
    vi.mocked(apiFetch).mockImplementation((path) => path === "/api/operators/scan"
      ? Promise.reject(Object.assign(new Error("Validation failed"), { status: 400, payload: { error: "Validation failed", details: [{ path: "pullSecret", message: "Pull secret must be valid JSON with auths object" }] } }))
      : api(path));
    render(<Host />);
    await armMounted();
    fireEvent.click(await screen.findByRole("button", { name: /Scan catalogs/ }));
    expect(await screen.findByText("The scan was not started: Pull secret must be valid JSON with auths object")).toBeTruthy();
  });

  it("FQ-SCAN-1: a mounted pull secret is used only when switched on; otherwise the pasted one, inline", async () => {
    const bodies = [];
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/operators/scan") bodies.push(JSON.parse(opts.body));
      return api(path);
    });
    render(<Host />);
    const sw = await screen.findByRole("switch", { name: /mounted into the container/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    const scan = screen.getByRole("button", { name: /Scan catalogs/ });
    expect(scan).toBeDisabled(); // neither pasted nor chosen
    fireEvent.click(sw);
    expect(screen.queryByRole("textbox", { name: /pull secret/i })).toBeNull();
    fireEvent.click(scan);
    await screen.findByText(/^No catalog could be scanned\./);
    expect(bodies[0]).toEqual({ catalogMinor: "4.22", profileId: "p-reason", rhAuthSource: "mounted" });
  });

  it("different reasons per catalog: the banner points to the per-catalog reasons", () => {
    const statuses = { redhat: failedJob("a", "redhat", "reason one"), certified: failedJob("b", "certified", "reason two"), community: failedJob("c", "community", "reason one") };
    expect(describeScanFailure(["redhat", "certified", "community"], statuses, 3)).toBe("No catalog could be scanned. The reason for each catalog is shown below.");
  });
});
