/**
 * v2.3.0 owner QA (2026-11-17), P4/P5 — one readiness evidence bundle and plain-language guidance.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ReadinessTab from "../src/upgrade/ReadinessTab.jsx";
import { guideFor } from "../src/upgrade/readinessGuide.js";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const plan = {
  id: "u-ready0000001", name: "Prod", kind: "planned", current: "4.20.14", target: "4.22.22", updatedAt: "1",
  path: { path: ["4.20.14", "4.20.44", "4.21.40", "4.22.22"], hops: [{ from: "4.20.14", to: "4.20.44", kind: "z-stream" }, { from: "4.20.44", to: "4.21.40", kind: "minor" }, { from: "4.21.40", to: "4.22.22", kind: "minor" }] },
  stages: [], mirror: { method: "mirrorToDisk" }, inventory: null
};
const checks = [
  { id: "cvo-health", group: "cluster", state: "NOT_CHECKED", title: "Cluster version operator", detail: "No evidence.", action: { kind: "import", inventoryKind: "clusterversion" } },
  { id: "etcd-backup", group: "cluster", state: "NOT_CHECKED", title: "etcd backup", detail: "Take one.", attestable: true },
  { id: "operator-compat", group: "cluster", state: "NOT_CHECKED", title: "Operator compatibility", detail: "No evidence.", attestable: true, action: { kind: "import", inventoryKind: "csv" } }
];
const readiness = { checks, summary: { state: "incomplete", blocked: 0, pending: 0, notChecked: 3, warnings: 0, attested: 0, clusterReadiness: "not verified (no cluster evidence)" }, cpo: null, attestable: { "etcd-backup": "A current etcd backup exists.", "operator-compat": "Operators confirmed." }, inventoryCommands: { clusterversion: "oc get clusterversion version -o json", csv: "c", subscription: "s", mcp: "m" } };

let posts;
beforeEach(() => {
  posts = [];
  _resetSourceCredentialsForTests();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((p, opts = {}) => {
    if (p.endsWith("/readiness")) return Promise.resolve(readiness);
    if (p.endsWith("/inventory/bundle")) {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ inventory: { source: "bundle", collectedAt: "2026-11-17T08:00:00.000Z" }, sections: { clusterversion: { state: "imported" }, adminacks: { state: "unavailable", reason: "forbidden" } } });
    }
    return Promise.resolve({});
  });
});
afterEach(cleanup);

const Host = () => {
  const [p, setP] = React.useState(plan);
  return <ReadinessTab plan={p} onPlanChanged={() => setP((x) => ({ ...x, updatedAt: String(Number(x.updatedAt) + 1), inventory: { source: "bundle", collectedAt: "2026-11-17T08:00:00.000Z", importedAt: "2026-11-17T09:00:00.000Z", sections: { clusterversion: { state: "imported", count: 1 }, adminacks: { state: "unavailable", reason: "forbidden" } } } }))} />;
};

describe("one readiness bundle (P4)", () => {
  it("download, run and upload one file; the result shows its collection time and what could not be read", async () => {
    render(<Host />);
    const box = (await screen.findByRole("heading", { name: "Check my cluster's readiness" })).closest("[role=group]");
    expect(within(box).getByRole("button", { name: "Download oaa-readiness-collector.sh" })).toBeInTheDocument();
    expect(within(box).getByText("bash oaa-readiness-collector.sh")).toBeInTheDocument();
    const reads = [...box.querySelectorAll("details li code")].map((c) => c.textContent).join("\n");
    expect(reads).toMatch(/oc get clusteroperators/);
    expect(reads).not.toMatch(/\bsecrets?\b/i);
    // The native file input is hidden behind the shared drop zone.
    const input = box.querySelector('input[type="file"]');
    expect(input.hidden).toBe(true);
    expect(within(box).getByRole("button", { name: /Choose a file: Readiness bundle/ })).toBeInTheDocument();
    const file = new File([JSON.stringify({ kind: "OAAReadinessBundle" })], "oaa-readiness-x.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(posts.length).toBe(1));
    expect(JSON.parse(posts[0].text).kind).toBe("OAAReadinessBundle");
    await waitFor(() => expect(within(box).getByText("2026-11-17T08:00:00.000Z")).toBeInTheDocument());
    expect(within(box).getByText(/Acknowledgements given: not readable \(forbidden\)/)).toBeInTheDocument();
    expect(within(box).getByText(/stay “Not checked”/)).toBeInTheDocument();
  });

  it("a file over 20 MiB is refused in the browser", async () => {
    render(<Host />);
    const box = (await screen.findByRole("heading", { name: "Check my cluster's readiness" })).closest("[role=group]");
    const big = new File(["x"], "big.json");
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    fireEvent.change(box.querySelector('input[type="file"]'), { target: { files: [big] } });
    expect(await screen.findByText(/larger than 20 MiB/)).toBeInTheDocument();
    expect(posts).toEqual([]);
  });
});

describe("plain-language guidance (P5)", () => {
  it("each check explains what, why, how (exact commands), success, failure and the documentation for its minor", async () => {
    render(<Host />);
    const row = (await screen.findByText("Cluster version operator")).closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "How to check: Cluster version operator" }));
    for (const t of ["What it is", "Why it matters", "How to check", "Success looks like", "If it fails", "Red Hat documentation"]) expect(within(row).getByText(t)).toBeInTheDocument();
    expect(within(row).getByText("oc get clusterversion")).toBeInTheDocument();
    expect(within(row).getByText(/Included in the readiness bundle/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /OpenShift 4\.20 · Updating clusters/ })).toHaveAttribute("href", "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/updating_clusters/index");
  });

  it("etcd: guidance only, never a restore, and the item stays the administrator's statement", async () => {
    render(<Host />);
    const row = (await screen.findByText("etcd backup")).closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "How to check: etcd backup" }));
    expect(within(row).getByText(/Architect cannot check this/)).toBeInTheDocument();
    expect(within(row).getByText("/usr/local/bin/cluster-backup.sh /home/core/assets/backup")).toBeInTheDocument();
    expect(within(row).getByText(/never takes, checks or restores a backup/)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /OpenShift 4\.20 · etcd › Backing up and restoring etcd data › Backing up etcd/ })).toBeInTheDocument();
    expect(within(row).getByText(/never as verified/)).toBeInTheDocument();
  });

  it("operator and preparation guidance link each minor the route updates to", () => {
    const g = guideFor("operator-compat", plan);
    expect(g.docs.map((d) => d.url)).toEqual([
      "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/operators/index",
      "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/updating_clusters/index",
      "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/updating_clusters/index"
    ]);
    expect(g.what).toMatch(/do not have to be updated at every step/);
    expect(guideFor("admin-acks", plan).commands.find((c) => /patch/.test(c.cmd)).note).toMatch(/CHANGES THE CLUSTER/);
    expect(guideFor("route", plan)).toBeNull();
  });
});
