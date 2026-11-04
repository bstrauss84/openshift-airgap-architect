/**
 * Owner B (2026-11-03): the destination registry (the docker:// push target)
 * and Help me generate's registry address (the credential's scope) agree —
 * related, never silently merged. Synthetic credentials only.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import { destinationKey, credentialsCover } from "../src/mirroring/DestinationCredentialsField.jsx";
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

let bodies;
let writes;
let runs;
const profileWith = (registryUrl) => ({
  id: "p-dest0000001", name: "Dest", updatedAt: 1, kind: "planned", content: { platform: false, operators: false, additionalImages: true },
  platform: { release: {}, version: {} }, operators: { catalogMinor: null, selected: [] }, additionalImages: [{ id: "i", name: "quay.io/a/b:1", source: "user" }],
  options: {}, execution: { mode: "mirrorToMirror", registryUrl, options: {} }, history: [], transfers: [], received: [], readiness: [],
  paths: { root: "/d", archivePath: "/d/a", workspacePath: "/d/w", cachePath: "/d/c", receivedPath: "/d/r" }
});
beforeEach(() => {
  _resetSourceCredentialsForTests();
  bodies = []; writes = []; runs = [];
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs, activeVerification: null });
    if (/^\/api\/jobs\//.test(path)) return Promise.resolve({ id: "job-r", status: "running", progress: 1, output: "" });
    if (path.startsWith("/api/mirroring/storage")) return Promise.resolve({ configured: { base: "/d", source: "default", ok: true }, profile: { base: "/d", source: "default", ok: true, paths: profileWith("").paths } });
    if (/\/preflight$/.test(path)) { bodies.push(JSON.parse(opts.body)); return Promise.resolve({ ok: false, blockers: ["x"], warnings: [], items: [] }); }
    if (/^\/api\/mirroring\/profiles\/[^/]+$/.test(path) && opts.method === "POST") { writes.push(JSON.parse(opts.body)); return Promise.resolve(profileWith("")); }
    return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
  });
});
afterEach(cleanup);

const creds = async () => (await screen.findByRole("heading", { name: "Credentials and destination for this run" })).closest("section");
const destInput = (c) => within(c).getByRole("textbox", { name: /^Destination registry(?! credentials)/ });
const generate = (entries) => {
  const dialog = screen.getByRole("dialog", { name: "Destination registry credentials" });
  entries.forEach(([registry, user, pw], i) => {
    if (i > 0) fireEvent.click(within(dialog).getByRole("button", { name: "Add another registry" }));
    const group = within(dialog).getAllByRole("group").filter((g) => /^Registry/.test(g.querySelector("legend")?.textContent || ""))[i];
    fireEvent.change(within(group).getByLabelText(/Registry address/), { target: { value: registry } });
    fireEvent.change(within(group).getByLabelText(/User name/), { target: { value: user } });
    fireEvent.change(within(group).getByLabelText(/Password or token/), { target: { value: pw } });
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use these credentials" }));
};

describe("destination ↔ credentials (owner B)", () => {
  it("parsing: the auth key and the docker:// destination are different strings; coverage is by path prefix", () => {
    expect(destinationKey("docker://Mirror.Example.com:8443/ocp/")).toBe("mirror.example.com:8443/ocp");
    expect(destinationKey("mirror.example.com:8443")).toBe("mirror.example.com:8443");
    expect(destinationKey("")).toBe("");
    expect(credentialsCover(["mirror.example.com:8443"], "mirror.example.com:8443/ocp")).toBe(true);
    expect(credentialsCover(["mirror.example.com:8443/ocp"], "mirror.example.com:8443/ocp/release")).toBe(true);
    expect(credentialsCover(["mirror.example.com:8443/ocp"], "mirror.example.com:8443")).toBe(false);
    expect(credentialsCover(["mirror.example.com"], "mirror.example.com:8443/ocp")).toBe(false); // port is part of the registry
    expect(credentialsCover(["mirror.example.com:8443/oc"], "mirror.example.com:8443/ocp")).toBe(false); // path boundary
  });

  it("empty destination: one generated registry becomes the destination exactly as typed (no path invented); preflight uses it", async () => {
    render(<MirroringRunPanel profile={profileWith("")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    generate([["mirror.b.example.com:5000", "pusher", "pw-1"]]);
    expect(destInput(c)).toHaveValue("mirror.b.example.com:5000");
    expect(within(c).getByText(/Destination set to mirror\.b\.example\.com:5000 from the credentials/)).toBeInTheDocument();
    await waitFor(() => expect(writes.at(-1)).toEqual({ execution: { registryUrl: "mirror.b.example.com:5000" } }));
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].registryUrl).toBe("mirror.b.example.com:5000");
  });

  it("set destination: the helper starts from its host[:port]; a different registry asks — Keep leaves the destination and warns", async () => {
    render(<MirroringRunPanel profile={profileWith("mirror.a.example.com:8443/ocp")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    expect(within(screen.getByRole("dialog")).getByLabelText(/Registry address/)).toHaveValue("mirror.a.example.com:8443");
    generate([["mirror.b.example.com:5000", "pusher", "pw-1"]]);
    expect(destInput(c)).toHaveValue("mirror.a.example.com:8443/ocp"); // not silently re-targeted
    const choice = within(c).getByRole("alert");
    expect(choice).toHaveTextContent("These credentials are for mirror.b.example.com:5000, but the destination is mirror.a.example.com:8443/ocp");
    fireEvent.click(within(choice).getByRole("button", { name: "Keep mirror.a.example.com:8443/ocp" }));
    expect(destInput(c)).toHaveValue("mirror.a.example.com:8443/ocp");
    expect(within(c).getByText(/None of these credentials is for the destination/)).toBeInTheDocument();
    expect(writes).toHaveLength(0);
  });

  it("…or the user explicitly takes the credentials' registry as the destination", async () => {
    render(<MirroringRunPanel profile={profileWith("mirror.a.example.com:8443/ocp")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    generate([["mirror.b.example.com:5000", "pusher", "pw-1"]]);
    fireEvent.click(within(c).getByRole("button", { name: "Use mirror.b.example.com:5000 as the destination" }));
    expect(destInput(c)).toHaveValue("mirror.b.example.com:5000");
    expect(within(c).queryByText(/None of these credentials is for the destination/)).toBeNull();
  });

  it("matching host with a path: no question, no warning", async () => {
    render(<MirroringRunPanel profile={profileWith("mirror.a.example.com:8443/ocp")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    generate([["mirror.a.example.com:8443", "pusher", "pw-1"]]);
    expect(within(c).queryByRole("alert")).toBeNull();
    expect(within(c).queryByText(/None of these credentials/)).toBeNull();
    expect(destInput(c)).toHaveValue("mirror.a.example.com:8443/ocp");
  });

  it("several registries: never a guess — the empty destination stays empty and the user is asked to enter it", async () => {
    render(<MirroringRunPanel profile={profileWith("")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    generate([["mirror.a.example.com:8443", "u1", "p1"], ["mirror.b.example.com:5000", "u2", "p2"]]);
    expect(destInput(c)).toHaveValue("");
    expect(within(c).getByText(/name several registries, so none is taken as the destination/)).toBeInTheDocument();
  });

  it("pasted JSON: one entry offers (does not force) it as the destination; several entries offer nothing", async () => {
    render(<MirroringRunPanel profile={profileWith("")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    const box = within(c).getByRole("textbox", { name: /Destination registry credentials/ });
    fireEvent.change(box, { target: { value: JSON.stringify({ auths: { "a.example.com:5000": { auth: btoa("u:p") }, "b.example.com": { auth: btoa("u:p") } } }) } });
    fireEvent.blur(box);
    expect(within(c).queryByRole("button", { name: /as the destination/ })).toBeNull();
    fireEvent.change(box, { target: { value: JSON.stringify({ auths: { "a.example.com:5000": { auth: btoa("u:p") } } }) } });
    fireEvent.blur(box);
    expect(destInput(c)).toHaveValue("");
    fireEvent.click(within(c).getByRole("button", { name: "Use a.example.com:5000 as the destination" }));
    expect(destInput(c)).toHaveValue("a.example.com:5000");
  });

  it("Cancel changes neither the destination nor the credentials", async () => {
    render(<MirroringRunPanel profile={profileWith("")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Registry address/), { target: { value: "mirror.b.example.com:5000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(destInput(c)).toHaveValue("");
    expect(writes).toHaveLength(0);
  });

  it("anonymous: no generator, the destination is still required, and a change after preflight makes it stale", async () => {
    render(<MirroringRunPanel profile={profileWith("")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("radio", { name: /Anonymous access/ }));
    expect(within(c).queryByRole("button", { name: "Help me generate" })).toBeNull();
    expect(within(c).getByText(/Enter the destination registry first/)).toBeInTheDocument();
    fireEvent.change(destInput(c), { target: { value: "anon.example.com:5000/ocp" } });
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ registryUrl: "anon.example.com:5000/ocp", mirrorPullSecret: '{"auths":{"anon.example.com:5000":{"auth":"aWQ6cGFzcwo=","email":""}}}' });
  });

  it("while a run is going, the destination cannot be edited", async () => {
    runs = [{ jobId: "job-r", status: "running", mode: "mirrorToMirror", plan: null }];
    render(<MirroringRunPanel profile={profileWith("mirror.a.example.com:8443/ocp")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    await waitFor(() => expect(destInput(c)).toBeDisabled());
  });
});

describe("notes follow the destination", () => {
  it("'Destination set … from the credentials' disappears once the user types another destination", async () => {
    render(<MirroringRunPanel profile={profileWith("")} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    fireEvent.click(within(c).getByRole("button", { name: "Help me generate" }));
    generate([["mirror.b.example.com:5000", "pusher", "pw-1"]]);
    expect(within(c).getByText(/Destination set to mirror\.b\.example\.com:5000/)).toBeInTheDocument();
    fireEvent.change(destInput(c), { target: { value: "mirror.c.example.com/ocp" } });
    expect(within(c).queryByText(/Destination set to/)).toBeNull();
    expect(within(c).getByText(/None of these credentials is for the destination/)).toBeInTheDocument();
  });
});

describe("destination credentials have the Red Hat field's width (owner, 2026-11-04)", () => {
  it.each([
    ["mirror to mirror", profileWith("mirror.a.example.com:8443/ocp")],
    ["disk to mirror (received profile)", { ...profileWith("mirror.a.example.com:8443/ocp"), kind: "received", origin: { profileId: "p-low0000001", profileName: "Site A", planId: "plan-20261104T000000Z-abcdef" }, received: [{ planId: "plan-20261104T000000Z-abcdef", origin: { profileId: "p-low0000001", profileName: "Site A", planId: "plan-20261104T000000Z-abcdef" }, configSha256: "c".repeat(64), receivedAt: 1, summary: "1 additional image(s)", archives: [] }], execution: { mode: "diskToMirror", registryUrl: "mirror.a.example.com:8443/ocp", options: {} } }]
  ])("%s: the field sits in the shared constrained container (as the Red Hat pull secret does)", async (_label, p) => {
    render(<MirroringRunPanel profile={p} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const c = await creds();
    const box = within(c).getByRole("textbox", { name: /Destination registry credentials/ });
    expect(box.closest(".credentials-field-constrained")).not.toBeNull();
    expect(box.closest(".mirroring-destination-cred")).toHaveClass("credentials-field-constrained");
  });
});

describe("Option B: the received transfer says whether this server's oc-mirror is the connected side's executable", () => {
  const received = (toolIdentity) => ({ ...profileWith("mirror.a.example.com:8443/ocp"), kind: "received", origin: { profileId: "p-low0000001", profileName: "Site A", planId: "plan-20261104T000000Z-abcdef" }, received: [{ planId: "plan-20261104T000000Z-abcdef", origin: { profileId: "p-low0000001", profileName: "Site A", planId: "plan-20261104T000000Z-abcdef" }, configSha256: "c".repeat(64), receivedAt: 1, summary: "1 additional image(s)", archives: [], ...(toolIdentity ? { toolIdentity } : {}) }], execution: { mode: "diskToMirror", registryUrl: "mirror.a.example.com:8443/ocp", options: {} } });
  it.each([
    [{ status: "match" }, /same executable as the connected side \(identical bytes — not a FIPS or suitability statement\)/],
    [{ status: "different" }, /a different executable from the connected side \(often the build for this machine's RHEL version or CPU\)/],
    [{ status: "not-recorded" }, /does not record the connected side's executable SHA-256/],
    [null, /received before builds were compared/]
  ])("%o", async (identity, text) => {
    render(<MirroringRunPanel profile={received(identity)} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Received transfers" });
    expect(within(list).getByText(text)).toBeInTheDocument();
  });
});
