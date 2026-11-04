/**
 * v2.2.0 R-UX02 — one transient Red Hat source credential per Mirroring
 * profile session, reused only where accepted; and the anonymous destination
 * option carried over from Install (OKD placeholder).
 *
 * Synthetic credentials only.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import SourceCredentialField from "../src/mirroring/SourceCredentialField.jsx";
import { _resetSourceCredentialsForTests, getSourceCredential, forgetSourceCredential } from "../src/mirroring/sourceCredentialSession.js";
import { anonymousRegistryAuthJson, OKD_ANONYMOUS_DOC_URL } from "../src/shared/registryAuth.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const SECRET_A = JSON.stringify({ auths: { "registry.redhat.io": { auth: btoa("rh:token-a") }, "quay.io": { auth: btoa("rh:token-a") } } });
const SECRET_B = JSON.stringify({ auths: { "registry.redhat.io": { auth: btoa("rh:token-b") } } });
let bodies;
let mounted;
const baseProfile = {
  id: "p-sess0000001", name: "Session", updatedAt: 1, kind: "planned", content: { platform: false, operators: true, additionalImages: false },
  platform: { release: {}, version: {} }, operators: { catalogMinor: "4.22", selected: [] }, additionalImages: [],
  options: {}, execution: { mode: "mirrorToDisk", registryUrl: "", options: {} }, history: [], transfers: [], received: [], readiness: [],
  paths: { root: "/d", archivePath: "/d/a", workspacePath: "/d/w", cachePath: "/d/c", receivedPath: "/d/r" }
};
beforeEach(() => {
  _resetSourceCredentialsForTests();
  sessionStorage.clear();
  localStorage.clear();
  bodies = [];
  mounted = false;
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: mounted });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
    if (path.startsWith("/api/mirroring/storage")) return Promise.resolve({ configured: { base: "/d", source: "default", ok: true }, profile: { base: "/d", source: "default", ok: true, paths: baseProfile.paths } });
    if (/\/preflight$/.test(path)) { bodies.push(JSON.parse(opts.body)); return Promise.resolve({ ok: false, blockers: ["x"], warnings: [], items: [] }); }
    if (/^\/api\/mirroring\/profiles\/[^/]+$/.test(path) && opts.method === "POST") return Promise.resolve(baseProfile);
    return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
  });
});
afterEach(cleanup);

const paste = (container, value) => {
  const box = within(container).getByRole("textbox", { name: /pull secret/i });
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
};
const runCreds = async () => (await screen.findByRole("heading", { name: /^Credentials/ })).closest("section");

describe("session source credential (R-UX02)", () => {
  it("entered for the scan, offered — not used — in the run until accepted; then sent with preflight; nothing stored", async () => {
    render(<><div data-testid="scan"><SourceCredentialField profileId={baseProfile.id} site="scan" idPrefix="s" label="Red Hat pull secret for this scan" /></div><MirroringRunPanel profile={baseProfile} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} /></>);
    paste(screen.getByTestId("scan"), SECRET_A);
    expect(within(screen.getByTestId("scan")).getByRole("status")).toHaveTextContent(/entered for this profile.*registry\.redhat\.io, quay\.io/);
    const creds = await runCreds();
    expect(within(creds).getByText(/was entered for the catalog scan of this profile/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].rhPullSecret).toBeUndefined(); // not accepted here yet
    fireEvent.click(within(creds).getByRole("button", { name: "Use it here" }));
    expect(creds.textContent).toMatch(/entered for the catalog scan/);
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ rhAuthSource: "inline", rhPullSecret: SECRET_A });
    expect(sessionStorage.length + localStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toContain(btoa("rh:token-a"));
  });

  it("never shared with another profile", async () => {
    render(<SourceCredentialField profileId="p-other000001" site="scan" idPrefix="o" />);
    paste(document.body, SECRET_A);
    render(<MirroringRunPanel profile={baseProfile} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const creds = await runCreds();
    expect(within(creds).queryByRole("button", { name: "Use it here" })).toBeNull();
    expect(getSourceCredential(baseProfile.id)).toBeNull();
  });

  it("Replace swaps it for the profile (other places must accept again); Forget removes it everywhere; a reload forgets it", async () => {
    render(<><div data-testid="scan"><SourceCredentialField profileId={baseProfile.id} site="scan" idPrefix="s" /></div><div data-testid="run"><SourceCredentialField profileId={baseProfile.id} site="run" idPrefix="r" /></div></>);
    paste(screen.getByTestId("scan"), SECRET_A);
    fireEvent.click(within(screen.getByTestId("run")).getByRole("button", { name: "Use it here" }));
    fireEvent.click(within(screen.getByTestId("run")).getByRole("button", { name: "Replace" }));
    paste(screen.getByTestId("run"), SECRET_B);
    expect(getSourceCredential(baseProfile.id).secret).toBe(SECRET_B);
    expect(within(screen.getByTestId("scan")).getByRole("button", { name: "Use it here" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("run")).getByRole("button", { name: "Forget" }));
    expect(getSourceCredential(baseProfile.id)).toBeNull();
    expect(within(screen.getByTestId("scan")).getByRole("textbox", { name: /pull secret/i })).toBeInTheDocument();
    paste(screen.getByTestId("scan"), SECRET_A);
    _resetSourceCredentialsForTests(); // what a page reload does to module memory
    await waitFor(() => expect(within(screen.getByTestId("scan")).getByRole("textbox", { name: /pull secret/i })).toBeInTheDocument());
  });

  it("the mounted pull secret is an explicit choice that other places accept the same way", async () => {
    mounted = true;
    render(<><div data-testid="scan"><SourceCredentialField profileId={baseProfile.id} site="scan" idPrefix="s" mountedAvailable /></div><MirroringRunPanel profile={baseProfile} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} /></>);
    fireEvent.click(within(screen.getByTestId("scan")).getByRole("switch", { name: /mounted into the container/ }));
    const creds = await runCreds();
    expect(within(creds).getByText(/You chose the pull secret mounted into the container/)).toBeInTheDocument();
    fireEvent.click(within(creds).getByRole("button", { name: "Use it here" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies.at(-1)).toMatchObject({ rhAuthSource: "mounted" }));
    expect(bodies.at(-1).rhPullSecret).toBeUndefined();
  });

  it("deleting a profile forgets its credential", () => {
    render(<SourceCredentialField profileId={baseProfile.id} site="scan" idPrefix="s" />);
    paste(document.body, SECRET_A);
    forgetSourceCredential(baseProfile.id);
    expect(getSourceCredential(baseProfile.id)).toBeNull();
  });

  it("no Help me generate on the Red Hat source field; the console link is there", () => {
    render(<SourceCredentialField profileId={baseProfile.id} site="scan" idPrefix="s" label="Red Hat pull secret for this scan" />);
    expect(screen.queryByRole("button", { name: "Help me generate" })).toBeNull();
    expect(screen.getByRole("link", { name: /Red Hat pull secret/ })).toHaveAttribute("href", "https://console.redhat.com/openshift/install/pull-secret");
  });
});

describe("anonymous destination registry (carried over from Install)", () => {
  const m2m = { ...baseProfile, content: { platform: false, operators: false, additionalImages: true }, additionalImages: [{ id: "i", name: "quay.io/a/b:1", source: "user" }], execution: { mode: "mirrorToMirror", registryUrl: "mirror.example.com:8443/ocp", options: {} } };

  it("sends the OKD placeholder for the destination host, links the OKD discussion, hides the generator, and restores typed credentials when switched back", async () => {
    render(<MirroringRunPanel profile={m2m} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const creds = await runCreds();
    const dest = within(creds).getByRole("textbox", { name: /Destination registry credentials/ });
    const typed = JSON.stringify({ auths: { "mirror.example.com:8443": { auth: btoa("pusher:pw") } } });
    fireEvent.change(dest, { target: { value: typed } });
    fireEvent.blur(dest);
    fireEvent.click(within(creds).getByRole("radio", { name: /Anonymous access/ }));
    expect(within(creds).getByRole("link", { name: /OKD-documented dummy pull secret/ })).toHaveAttribute("href", OKD_ANONYMOUS_DOC_URL);
    expect(within(creds).queryAllByRole("button", { name: "Help me generate" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].mirrorPullSecret).toBe(anonymousRegistryAuthJson("mirror.example.com:8443"));
    expect(bodies[0].mirrorPullSecret).toBe('{"auths":{"mirror.example.com:8443":{"auth":"aWQ6cGFzcwo=","email":""}}}');
    fireEvent.click(within(creds).getByRole("radio", { name: /Use destination registry credentials/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].mirrorPullSecret).toBe(typed);
  });
});
