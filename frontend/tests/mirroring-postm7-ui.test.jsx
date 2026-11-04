/**
 * v2.2.0 post-M7: the air-gap mental model in the run card, receiving on the
 * same server, section-aware bulk image import, and the Mirroring Operations
 * view (list, details, live output, Stop, sanitized log, reload).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { parseImageList, MAX_IMAGE_LIST_BYTES } from "../src/shared/imageList.js";
import { validateImageRef } from "../src/shared/imageRef.js";
import BulkImagesDialog, { MAX_ADDITIONAL_IMAGES } from "../src/mirroring/BulkImagesDialog.jsx";
import AdditionalImagesEditor from "../src/mirroring/AdditionalImagesEditor.jsx";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import MirroringOperations, { elapsed } from "../src/mirroring/MirroringOperations.jsx";
import MirroringShell from "../src/mirroring/MirroringShell.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
beforeEach(() => _resetSourceCredentialsForTests());

const parse = (text, existing = []) => parseImageList(text, { validate: validateImageRef, existing });
const D = "a".repeat(64);

describe("bulk import: sections, order, malformed input", () => {
  it("a whole ImageSetConfiguration: only additionalImages entries are taken; other sections are reported by name", () => {
    const r = parse([
      "kind: ImageSetConfiguration",
      "apiVersion: mirror.openshift.io/v2alpha1",
      "mirror:",
      "  platform:",
      "    channels:",
      "    - name: stable-4.22",
      "  operators:",
      "  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.22",
      "    packages:",
      "    - name: cluster-logging",
      "      channels:",
      "      - name: stable-6.2",
      "  additionalImages:",
      "  - name: quay.io/org/app:v1",
      `  - name: registry.example.com:5000/x/y@sha256:${D}`,
      "  blockedImages:",
      "  - name: quay.io/org/never:1",
      "delete:",
      "  additionalImages:",
      "  - name: quay.io/org/old:0"
    ].join("\n"));
    expect(r.images).toEqual(["quay.io/org/app:v1", `registry.example.com:5000/x/y@sha256:${D}`]);
    expect(r.invalid).toEqual([]);
    expect(r.otherSections).toEqual({ channels: 2, operators: 1, packages: 1, blockedImages: 1, delete: 1 });
  });

  it("a hand-made list under any other header is still read; order, tags and digests are kept exactly", () => {
    const r = parse(`images:\n  - quay.io/b/two:2\n  - quay.io/a/one@sha256:${D}\n  - "quay.io/c/three:3.0-rc1"\n`);
    expect(r.images).toEqual(["quay.io/b/two:2", `quay.io/a/one@sha256:${D}`, "quay.io/c/three:3.0-rc1"]);
  });

  it("inline YAML, over-long references and malformed lines are refused with a reason, never guessed at", () => {
    const r = parse([
      "- {name: quay.io/a/b:1}",
      "[quay.io/a/b:1, quay.io/a/c:1]",
      `quay.io/a/${"x".repeat(520)}:1`,
      "- name: \"quay.io/unclosed:1",
      "\t- quay.io/tab/indented:1",
      "name quay.io/a/b:1"
    ].join("\n"));
    expect(r.images).toEqual(["quay.io/tab/indented:1"]);
    expect(r.invalid.map((p) => [p.line, p.reason])).toEqual([
      [1, "Inline YAML ({…} or […]) is not read; put each image on its own line."],
      [2, "Inline YAML ({…} or […]) is not read; put each image on its own line."],
      [3, "An image reference can be at most 512 characters."],
      [4, "Use a container image reference without spaces or quotes, for example quay.io/org/app:v1."],
      [6, "Only one image per line."]
    ]);
  });

  it("a long list: every line read in order", () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `quay.io/load/img-${i}:1`);
    const r = parse(lines.join("\n"));
    expect(r.images).toHaveLength(1200);
    expect(r.images[0]).toBe("quay.io/load/img-0:1");
    expect(r.images[1199]).toBe("quay.io/load/img-1199:1");
  });
});

describe("bulk import dialog", () => {
  afterEach(cleanup);
  const open = (props = {}) => render(<BulkImagesDialog isOpen onClose={props.onClose || vi.fn()} onAdd={props.onAdd || vi.fn()} existing={props.existing || []} idPrefix="t" />);

  it("more images than the profile can hold: says how many fit and does not add", () => {
    const onAdd = vi.fn();
    open({ onAdd, existing: ["quay.io/x/existing:1"] });
    fireEvent.change(screen.getByRole("textbox", { name: /Images, one per line/ }), { target: { value: Array.from({ length: MAX_ADDITIONAL_IMAGES }, (_, i) => `quay.io/l/i${i}:1`).join("\n") } });
    expect(screen.getByText(/only 499 more fit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Add ${MAX_ADDITIONAL_IMAGES} image(s)` })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("pasted text over 1 MiB is refused like a file", () => {
    open();
    fireEvent.change(screen.getByRole("textbox", { name: /Images, one per line/ }), { target: { value: `quay.io/a/b:1\n${"#".repeat(MAX_IMAGE_LIST_BYTES)}` } });
    expect(screen.getByRole("alert")).toHaveTextContent("larger than 1 MiB");
    expect(screen.getByRole("button", { name: "Add images" })).toBeDisabled();
  });

  it("other sections are named in the preview", () => {
    open();
    fireEvent.change(screen.getByRole("textbox", { name: /Images, one per line/ }), { target: { value: "additionalImages:\n- name: quay.io/a/b:1\nblockedImages:\n- name: quay.io/a/c:1\n- name: quay.io/a/d:1" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 new image(s) will be added");
    expect(screen.getByRole("status")).toHaveTextContent("2 entries under blockedImages: (not images to mirror, ignored)");
  });

  it("keyboard: focus starts inside the dialog; Escape closes it and adds nothing", async () => {
    const onClose = vi.fn();
    const onAdd = vi.fn();
    open({ onClose, onAdd });
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.change(screen.getByRole("textbox", { name: /Images, one per line/ }), { target: { value: "quay.io/a/b:1" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("existing entries are kept exactly, in order, ahead of the new ones", async () => {
    let saved = null;
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((p, o = {}) => { saved = JSON.parse(o.body); return Promise.resolve({ id: "p-1", additionalImages: saved.additionalImages }); });
    const profile = { id: "p-ui00000081", additionalImages: [
      { id: "img-b", name: "quay.io/z/last:9", source: "imported", importId: "imp-1" },
      { id: "img-a", name: `quay.io/a/first@sha256:${D}`, source: "user" }
    ] };
    render(<AdditionalImagesEditor profile={profile} onProfileChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add several…" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Images, one per line/ }), { target: { value: "quay.io/n/new:1\nquay.io/z/last:9" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 1 image(s)" }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved.additionalImages.slice(0, 2)).toEqual([
      expect.objectContaining({ id: "img-b", name: "quay.io/z/last:9", source: "imported" }),
      expect.objectContaining({ id: "img-a", name: `quay.io/a/first@sha256:${D}`, source: "user" })
    ]);
    expect(saved.additionalImages.map((i) => i.name)).toEqual(["quay.io/z/last:9", `quay.io/a/first@sha256:${D}`, "quay.io/n/new:1"]);
  });
});

/* ---------------- run panel: mental model and same-server receive ---------------- */

const paths = (id) => ({ root: `/data/oc-mirror/profiles/${id}`, archivePath: `/data/oc-mirror/profiles/${id}/archives`, workspacePath: `/w/${id}`, cachePath: `/c/${id}`, receivedPath: `/data/oc-mirror/profiles/${id}/received` });
const planned = (extra = {}) => ({
  id: "p-ui00000082", name: "Planned", updatedAt: 1, kind: "planned",
  content: { platform: false, operators: false, additionalImages: true }, platform: { release: {}, version: {} }, operators: { catalogMinor: null, selected: [] },
  additionalImages: [{ id: "img-a", name: "quay.io/a/b:1", source: "user" }], options: {}, execution: { mode: "mirrorToDisk", registryUrl: "", options: {} },
  history: [], transfers: [], received: [], readiness: [], paths: paths("p-ui00000082"), ...extra
});
const PLAN = "plan-20261030T120000Z-abcdef";

describe("run card: the air-gap steps and receiving on the same server", () => {
  let runs;
  beforeEach(() => {
    runs = [];
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
      if (/\/runs$/.test(path)) return Promise.resolve({ runs, activeVerification: null });
      if (path === "/api/mirroring/receive") return Promise.resolve({ jobId: "job-recv" });
      if (path === "/api/jobs/job-recv") return Promise.resolve({ id: "job-recv", status: "running", progress: 10, message: "Receiving the transfer: checking files…" });
      return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
    });
  });
  afterEach(cleanup);

  const stepState = (title) => {
    const li = within(screen.getByRole("list", { name: "Mirroring across an air gap" })).getByText(title).closest("li");
    return [li.querySelector(".mirroring-step-state").textContent, li.getAttribute("aria-current")];
  };

  it("a new planned profile: Mirror to disk is next; the rest are numbered steps; mirror to mirror is explained", async () => {
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    await waitFor(() => expect(stepState("Mirror to disk")).toEqual(["Next", "step"]));
    expect(stepState("Prepare transfer")).toEqual(["Step 2", null]);
    expect(stepState("Receive transfer")).toEqual(["Step 4", null]);
    expect(screen.getByText(/Mirror to mirror skips all of this/)).toBeInTheDocument();
    expect(screen.getByText(/upload the verified archives into your registry/)).toBeInTheDocument();
  });

  it("after a completed mirror to disk Prepare transfer is next; once prepared, carrying the files is next", async () => {
    runs = [{ jobId: "j1", status: "completed", mode: "mirrorToDisk", dryRun: false, plan: { planId: PLAN, configSha256: "c".repeat(64) } }];
    const { unmount } = render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    await waitFor(() => expect(stepState("Prepare transfer")).toEqual(["Next", "step"]));
    expect(stepState("Mirror to disk")).toEqual(["Done", null]);
    unmount();
    render(<MirroringRunPanel profile={planned({ transfers: [{ jobId: "j1", planId: PLAN, archives: [], offlineReady: true }] })} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    await waitFor(() => expect(stepState("Carry the files across")).toEqual(["Next", "step"]));
  });

  it("the prepare card says what to do with a ready transfer and offers no way to receive it into the same profile", async () => {
    runs = [{ jobId: "j1", status: "completed", mode: "mirrorToDisk", dryRun: false, plan: { planId: PLAN, configSha256: "c".repeat(64) } }];
    const onShowOperation = vi.fn();
    render(<MirroringRunPanel profile={planned({ transfers: [{ jobId: "j1", planId: PLAN, archives: [], offlineReady: true }] })} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} onShowOperation={onShowOperation} />);
    const prepare = (await screen.findByRole("heading", { name: "Prepare the transfer" })).closest("section");
    await waitFor(() => expect(within(prepare).getByText(/receive them on the disconnected side/)).toBeInTheDocument());
    expect(within(prepare).getByRole("button", { name: "Prepare again" })).toBeInTheDocument();
    expect(within(prepare).queryByRole("button", { name: /Receive/ })).toBeNull();
    // The per-profile activity card is gone (R-UX08): history and details are in Operations.
    expect(screen.queryByRole("heading", { name: "Mirroring activity" })).toBeNull();
  });

  it("same Architect on both sides: the dialog offers this profile's prepared transfer, and receiving it uses the strict receive", async () => {
    const p = planned({ transfers: [{ jobId: "j1", planId: PLAN, archives: [], offlineReady: true }] });
    render(<MirroringRunPanel profile={p} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Receive a transfer here…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A transfer is not another mirror run/)).toBeInTheDocument();
    expect(within(dialog).getByText(/needs as much free space as the transfer/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this profile's transfer" }));
    expect(within(dialog).getByRole("textbox", { name: /Transfer directory/ })).toHaveValue(p.paths.archivePath);
    fireEvent.click(within(dialog).getByRole("button", { name: "Verify and receive" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([u, o]) => u === "/api/mirroring/receive" && JSON.parse(o.body).transferDir === p.paths.archivePath)).toBe(true));
  });

  it("without a prepared transfer the dialog makes no suggestion", async () => {
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Receive a transfer here…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Use this profile's transfer" })).toBeNull();
  });
});

describe("run panel order follows the workflow", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
      if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
      if (path.startsWith("/api/mirroring/storage")) return Promise.resolve({ configured: { base: "/mnt/mirror-data", source: "env", ok: true }, profile: { base: "/data/oc-mirror", source: "default", accepted: true, ok: true, freeBytes: 5 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, paths: paths("p-ui00000082") } });
      if (/^\/api\/mirroring\/profiles\/[^/]+$/.test(path) && opts.method === "POST") return Promise.resolve(planned());
      return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
    });
  });
  afterEach(cleanup);
  const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

  it("workflow first, then credentials, storage and options, preflight and run, the contextual transfer card (history lives in Operations — R-UX08)", async () => {
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    await screen.findByRole("heading", { name: "Prepare the transfer" });
    expect(headings()).toEqual(["Choose the mirroring workflow", "Credentials for this run", "Storage and run options", "Preflight and run", "Prepare the transfer"]);
  });

  it("switching the workflow changes the credentials card at once, keeps what was typed, and shows only the matching transfer card", async () => {
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const creds = () => screen.getByRole("heading", { name: /^Credentials/ }).closest("section");
    expect(within(creds()).getByRole("status")).toHaveTextContent("Mirror to disk needs credentials only for private source registries");
    expect(within(creds()).queryByRole("textbox", { name: /^Destination registry(?! credentials)/ })).toBeNull();
    const pull = within(creds()).getByRole("textbox", { name: /Pull secret/ });
    fireEvent.change(pull, { target: { value: '{"auths":{}}' } });
    const shownBefore = within(creds()).getByRole("textbox", { name: /Pull secret/ }).value; // masked by SecretInput
    expect(shownBefore).not.toBe("");
    const m2m = within(screen.getByRole("group", { name: "Workflow" })).getByRole("button", { name: /^Mirror to mirror/ });
    m2m.focus();
    fireEvent.click(m2m);
    expect(screen.getByRole("heading", { name: "Credentials and destination for this run" })).toBeInTheDocument();
    expect(within(creds()).getByRole("status")).toHaveTextContent("Mirror to mirror needs credentials for any private source registry and the destination registry");
    expect(within(creds()).getByRole("textbox", { name: /^Destination registry(?! credentials)/ })).toBeInTheDocument();
    expect(within(creds()).getByRole("textbox", { name: /Pull secret/ }).value).toBe(shownBefore);
    expect(creds().querySelectorAll(".field-error")).toHaveLength(0); // untouched new fields are not red
    expect(screen.queryByRole("heading", { name: "Prepare the transfer" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Received transfers" })).toBeNull();
    expect(headings()).toEqual(["Choose the mirroring workflow", "Credentials and destination for this run", "Storage and run options", "Preflight and run"]);
  });

  it("disk to mirror: the received transfers card (with the transfer to load) comes before preflight; no pull secret", async () => {
    const rec = { planId: PLAN, origin: { profileId: "p-low0000001", profileName: "Site A", planId: PLAN, planSha256: "a".repeat(64), jobId: "j" }, configSha256: "c".repeat(64), manifestSha256: "m".repeat(64), receivedAt: 1, summary: "1 additional image(s)", archives: [] };
    render(<MirroringRunPanel profile={planned({ id: "p-ui00000083", kind: "received", origin: rec.origin, received: [rec], execution: { mode: "diskToMirror", registryUrl: "", options: {} }, paths: paths("p-ui00000083") })} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    await screen.findByRole("heading", { name: "Received transfers" });
    expect(headings()).toEqual(["Choose the mirroring workflow", "Credentials and destination for this run", "Storage and run options", "Received transfers", "Preflight and run"]);
    const card = screen.getByRole("heading", { name: "Received transfers" }).closest("section");
    expect(within(card).getByRole("combobox", { name: /Received transfer/ })).toHaveValue(PLAN);
    expect(screen.queryByRole("textbox", { name: /Pull secret/ })).toBeNull();
    expect(screen.getByText(/Disk to mirror needs only the destination registry/)).toBeInTheDocument();
  });

  const storageReply = (profileExtra = {}, suggestions = null) => ({
    configured: { base: "/mnt/mirror-data", source: "env", ok: true },
    suggestions: suggestions || [
      { base: "/mnt/mirror-data", isDefault: true, isDataDirDefault: false, ok: true, problems: [], freeBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3 },
      { base: "/mnt/fast", isDefault: false, isDataDirDefault: false, ok: true, problems: [], freeBytes: 5 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }
    ],
    profile: { base: "/mnt/mirror-data", source: "configured", accepted: true, ok: true, freeBytes: 500 * 1024 ** 3, totalBytes: 1000 * 1024 ** 3, paths: paths("p-ui00000082"), choiceLocked: null, ...profileExtra }
  });
  const mockStorage = (reply, onChoose) => vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
    if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
    if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
    if (path.startsWith("/api/mirroring/storage/browse")) {
      const q = new URL(path, "http://x").searchParams.get("path");
      if (!q) return Promise.resolve({ path: null, roots: ["/data", "/mnt/mirror-data"], entries: [] });
      return Promise.resolve({ path: q, parent: q === "/mnt/mirror-data" ? null : "/mnt/mirror-data", root: "/mnt/mirror-data", roots: [], entries: q === "/mnt/mirror-data" ? ["site-a", "site-b"] : [], writable: true });
    }
    if (path.startsWith("/api/mirroring/storage")) return Promise.resolve(reply);
    if (/\/storage$/.test(path) && opts.method === "POST") return onChoose(JSON.parse(opts.body));
    return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
  });

  it("storage: like Install, any location can be typed while the profile is empty; mounted volumes are suggested", async () => {
    const chosen = [];
    const onProfileChanged = vi.fn();
    mockStorage(storageReply(), (body) => {
      chosen.push(body.base);
      if (body.base === "/etc/x") return Promise.reject(Object.assign(new Error("The location cannot be under the system directory /etc."), { status: 400 }));
      return Promise.resolve(planned({ storageBase: body.base }));
    });
    render(<MirroringRunPanel profile={planned()} onProfileChanged={onProfileChanged} onProfilesChanged={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: /Storage location/ });
    expect(input).toHaveValue("/mnt/mirror-data");
    expect(screen.getByText(/Any directory the server can write/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "relative/path" } });
    fireEvent.blur(input);
    expect(screen.getByText(/Use an absolute path inside the server/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "/etc/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this location" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The location cannot be under the system directory /etc."));
    expect(onProfileChanged).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "/mnt/mirror-data/site-a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onProfileChanged).toHaveBeenCalledWith(expect.objectContaining({ storageBase: "/mnt/mirror-data/site-a" })));
    fireEvent.click(screen.getByRole("button", { name: "Use /mnt/fast · 5.0 GiB free" }));
    await waitFor(() => expect(chosen).toEqual(["/etc/x", "/mnt/mirror-data/site-a", "/mnt/fast"]));
    const group = screen.getByRole("group", { name: "Storage" });
    fireEvent.click(within(group).getByRole("button", { name: /Paths on the server/ }));
    expect(within(group).getByText(paths("p-ui00000082").archivePath)).toBeInTheDocument();
    expect(within(group).getByText(/host/)).toBeInTheDocument();
  });

  it("storage: Browse lists folders on the server and uses the chosen one", async () => {
    const chosen = [];
    mockStorage(storageReply(), (body) => { chosen.push(body.base); return Promise.resolve(planned({ storageBase: body.base })); });
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: /Storage location/ });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a folder on the server" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "/mnt/mirror-data" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "site-a/" }));
    await waitFor(() => expect(within(dialog).getByText("/mnt/mirror-data/site-a")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(chosen).toEqual(["/mnt/mirror-data/site-a"]));
    expect(screen.queryByRole("dialog", { name: "Choose a folder on the server" })).toBeNull();
  });

  it("storage: fixed after the profile wrote something, with the reason; nothing is moved", async () => {
    mockStorage(storageReply({ choiceLocked: "This profile has runs; its archives, history and cache stay where they are." }));
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const group = await screen.findByRole("group", { name: "Storage" });
    await waitFor(() => expect(within(group).getByText(/Fixed for this profile: This profile has runs/)).toBeInTheDocument());
    expect(within(group).queryByRole("textbox")).toBeNull();
    expect(within(group).queryByRole("button", { name: "Use this location" })).toBeNull();
    expect(within(group).getByText("/mnt/mirror-data")).toBeInTheDocument();
  });

  it("storage: low space warns", async () => {
    mockStorage(storageReply({ freeBytes: 5 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }));
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const group = await screen.findByRole("group", { name: "Storage" });
    await waitFor(() => expect(within(group).getByText(/5\.0 GiB free of 100\.0 GiB — low/)).toBeInTheDocument());
  });

  it("storage that cannot be used says runs are blocked and why", async () => {
    mockStorage(storageReply({ ok: false, problem: "The storage root /mnt/x does not exist in the container." }));
    render(<MirroringRunPanel profile={planned()} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const group = await screen.findByRole("group", { name: "Storage" });
    await waitFor(() => expect(within(group).getByRole("alert")).toHaveTextContent("Runs are blocked. The storage root /mnt/x does not exist in the container."));
  });
});

/* ---------------- Operations ---------------- */

const OPS = [
  {
    jobId: "job-run", kind: "run", status: "running", title: "Mirror to disk", mode: "mirrorToDisk", profileId: "p-ui00000082", profileName: "Planned", profileExists: true,
    createdAt: Date.now() - 65000, startedAt: Date.now() - 65000, source: "Source registries named in the plan's configuration", destination: "/data/oc-mirror/profiles/p-ui00000082/archives",
    command: "/usr/local/bin/oc-mirror --config /data/plan/imageset-config.yaml --v2 --authfile <temporary credentials file, deleted after the run> file:///data/archives",
    tool: { version: "4.22.0-x-ed9ff0d", gitCommit: "ed9ff0d96dcbd591", sha256: "5".repeat(64) },
    plan: { planId: PLAN, configSha256: "c".repeat(64), kind: "generated" }, links: [{ label: "Transfer prepared from this run", jobId: "job-transfer" }], failedImages: []
  },
  { jobId: "job-transfer", kind: "transfer", status: "completed", title: "Prepare transfer", profileId: "p-ui00000082", profileName: "Planned", profileExists: true, createdAt: Date.now() - 10000, links: [{ label: "Mirror to disk it was prepared from", jobId: "job-run" }], archives: 2, bytes: 3 * 1024 ** 3, offlineReady: true, transferDir: "/data/archives" },
  { jobId: "job-recv-bad", kind: "receive", status: "failed", title: "Receive transfer", profileId: null, profileName: null, profileExists: false, createdAt: Date.now() - 5000, links: [], problems: ["mirror_000002.tar is missing."], recovery: ["Copy the missing archive file(s) again from the low side, then verify again."], transferDir: "/data/transfer/a" },
  { jobId: "job-other", kind: "catalog-check", status: "completed", title: "Live catalog check", profileId: "p-ui00000099", profileName: "Other", profileExists: true, createdAt: 1, links: [] }
];

describe("Mirroring Operations", () => {
  let stopped;
  beforeEach(() => {
    stopped = [];
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: OPS });
      const one = path.match(/^\/api\/mirroring\/operations\/([^/]+)$/);
      if (one) return Promise.resolve({ operation: { ...OPS.find((o) => o.jobId === one[1]), contentSummary: "1 additional image(s)" } });
      if (path === "/api/jobs/job-run/stop") { stopped.push("job-run"); return Promise.resolve({ ok: true }); }
      const job = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (job) {
        const o = OPS.find((x) => x.jobId === job[1]);
        return Promise.resolve({ id: o.jobId, status: o.status, message: "oc-mirror running.", output: "\x1b[32mINFO\x1b[0m copying image 1/2\r[====>   ] 50%\n", metadata_json: "{}" });
      }
      return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
    });
  });
  afterEach(cleanup);

  const renderOps = (selectedJobId = null, extra = {}) => {
    const onSelect = vi.fn();
    const onOpenProfile = vi.fn();
    const utils = render(<MirroringOperations profiles={[{ id: "p-ui00000082", name: "Planned" }, { id: "p-ui00000099", name: "Other" }]} selectedJobId={selectedJobId} onSelect={onSelect} onOpenProfile={onOpenProfile} {...extra} />);
    return { ...utils, onSelect, onOpenProfile };
  };

  it("lists every operation newest first with a written status, and filters by profile", async () => {
    const { onSelect } = renderOps();
    const list = await screen.findByRole("list", { name: "Operations" });
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(4));
    expect(within(list).getByRole("button", { name: /Mirror to disk\s*Running/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /Receive transfer\s*Failed/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: /Show/ }), { target: { value: "p-ui00000099" } });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: /Live catalog check/ }));
    expect(onSelect).toHaveBeenCalledWith("job-other");
  });

  it("a running run: command without credentials, tool identity, plan, live elapsed time, plain output, Stop", async () => {
    renderOps("job-run");
    const section = (await screen.findByRole("heading", { name: "Mirror to disk", level: 3 })).closest("section");
    await waitFor(() => expect(within(section).getByLabelText("Output")).toHaveTextContent("INFO copying image 1/2"));
    const out = within(section).getByLabelText("Output").textContent;
    expect(out.includes("\x1b[")).toBe(false);
    expect(out).toContain("\n[====>   ] 50%");
    expect(within(section).getByLabelText("oc-mirror command")).toHaveTextContent("--authfile <temporary credentials file, deleted after the run>");
    expect(within(section).getByText(/4\.22\.0-x-ed9ff0d · commit ed9ff0d96dcb/)).toBeInTheDocument();
    expect(within(section).getByText(PLAN)).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByText("1 additional image(s)")).toBeInTheDocument());
    expect(within(section).getByText("Running for")).toBeInTheDocument();
    expect(within(section).getByText(/^1 min \d+ s$/)).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(stopped).toEqual(["job-run"]));
  });

  it("an incomplete run: result in words, oc-mirror's error list, archive identities and storage root", async () => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: OPS });
      if (path === "/api/mirroring/operations/job-run") return Promise.resolve({ operation: { ...OPS[0], status: "completed_with_warnings", exitCode: 8,
        outcome: { state: "incomplete", text: "Incomplete: oc-mirror reported failures in additional images (exit code 8).", parts: ["additional images"] },
        errorFile: { file: "/data/a/working-dir/logs/mirroring_errors_1.txt", lines: ["error mirroring image quay.io/x/y:1 manifest unknown"], truncated: false },
        archiveList: [{ file: "mirror_000001.tar", bytes: 2 * 1024 ** 2, sha256: "e".repeat(64) }],
        storage: { base: "/mnt/mirror-data", source: "configured", accepted: true } } });
      if (path === "/api/jobs/job-run") return Promise.resolve({ id: "job-run", status: "completed_with_warnings", output: "done\n", metadata_json: JSON.stringify({ exitCode: 8 }) });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderOps("job-run");
    const section = (await screen.findByRole("heading", { name: "Mirror to disk", level: 3 })).closest("section");
    await waitFor(() => expect(within(section).getByText(/Incomplete: oc-mirror reported failures in additional images/)).toBeInTheDocument());
    expect(within(section).getByLabelText("oc-mirror error list")).toHaveTextContent("quay.io/x/y:1 manifest unknown");
    expect(within(section).getByRole("list", { name: "Archive files" })).toHaveTextContent(`mirror_000001.tar · 2.0 MiB · SHA-256 ${"e".repeat(64)}`);
    expect(within(section).getByText("/mnt/mirror-data")).toBeInTheDocument();
  });

  it("related operations are linked; the profile opens from the details", async () => {
    const { onSelect, onOpenProfile } = renderOps("job-run");
    const section = (await screen.findByRole("heading", { name: "Mirror to disk", level: 3 })).closest("section");
    fireEvent.click(within(section).getByRole("button", { name: "Transfer prepared from this run" }));
    expect(onSelect).toHaveBeenCalledWith("job-transfer");
    fireEvent.click(within(section).getByRole("button", { name: "Open “Planned”" }));
    expect(onOpenProfile).toHaveBeenCalledWith("p-ui00000082");
  });

  it("a failed receipt shows the real problems and how to fix them; no Stop for a receipt", async () => {
    renderOps("job-recv-bad");
    const section = (await screen.findByRole("heading", { name: "Receive transfer", level: 3 })).closest("section");
    const alert = within(section).getByRole("alert");
    expect(alert).toHaveTextContent("mirror_000002.tar is missing.");
    expect(alert).toHaveTextContent("To fix: Copy the missing archive file(s) again");
    expect(within(section).queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("Download log saves the server's sanitized text under the server's file name", async () => {
    const realFetch = global.fetch;
    const created = [];
    global.fetch = vi.fn(() => Promise.resolve(new Response("# OpenShift Airgap Architect — Mirroring operation log\nbody\n", { status: 200, headers: { "content-disposition": 'attachment; filename="mirroring-run-x.log"' } })));
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn((b) => { created.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const clicks = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() { clicks.push(this.download); };
    try {
      renderOps("job-run");
      const section = (await screen.findByRole("heading", { name: "Mirror to disk", level: 3 })).closest("section");
      fireEvent.click(within(section).getByRole("button", { name: "Download log" }));
      await waitFor(() => expect(clicks).toEqual(["mirroring-run-x.log"]));
      expect(global.fetch).toHaveBeenCalledWith("/api/mirroring/operations/job-run/log", expect.anything());
      const text = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(created[0]); });
      expect(text).toMatch(/^# OpenShift Airgap Architect/);
    } finally {
      global.fetch = realFetch;
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  it("an unfinished run says what to do next; Run the same again asks for fresh credentials and opens the new attempt", async () => {
    const retries = [];
    const failedRun = { ...OPS[0], status: "failed", exitCode: 8, mode: "mirrorToMirror", destination: "docker://mirror.example.com:8443/ocp",
      recovery: { classification: "RETRY_SAME", eligible: true, requires: ["credentials"], text: "Some images failed with temporary network or registry errors. Running the same again fetches only what is missing; what already arrived is kept." } };
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: [failedRun, { ...OPS[1], jobId: "job-attempt", title: "Mirror to mirror" }] });
      if (path === "/api/mirroring/operations/job-run") return Promise.resolve({ operation: failedRun });
      if (path === "/api/mirroring/operations/job-attempt") return Promise.resolve({ operation: { ...failedRun, jobId: "job-attempt", status: "completed", exitCode: 0, recovery: { classification: "NONE" },
        verification: { state: "partially-verified", scope: "destination manifests for 3 mapped image(s)", checks: [{ name: "Destination images present", ok: true, detail: "2 of 3 present." }, { name: "Could not check", ok: false, detail: "1 image(s) could not be checked." }] } } });
      if (/\/retry$/.test(path)) { retries.push(JSON.parse(opts.body)); return Promise.resolve({ jobId: "job-attempt" }); }
      const job = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (job) return Promise.resolve({ id: job[1], status: job[1] === "job-run" ? "failed" : "completed", output: "x\n", metadata_json: "{}" });
      return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
    });
    const { onSelect, rerender } = renderOps("job-run");
    const section = (await screen.findByRole("heading", { name: "Mirror to disk", level: 3 })).closest("section");
    await waitFor(() => expect(within(section).getByText(/What to do next: Can be run again/)).toBeInTheDocument());
    fireEvent.click(within(section).getByRole("button", { name: "Run the same again…" }));
    const dialog = await screen.findByRole("dialog", { name: "Run the same again" });
    expect(within(dialog).getByText(/byte for byte/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Credentials are needed again/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Destination registry(?! credentials)/ })).toHaveValue("mirror.example.com:8443/ocp");
    const destBox = within(dialog).getByRole("textbox", { name: /Destination registry credentials/ });
    fireEvent.change(destBox, { target: { value: '{"auths":{"mirror.example.com:8443":{"auth":"' + btoa("u:p") + '"}}}' } });
    fireEvent.blur(destBox); // SecretInput hands the value up when the field is left (as a real click does)
    fireEvent.click(within(dialog).getByRole("button", { name: "Run the same again" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("job-attempt"));
    expect(retries[0].registryUrl).toBe("mirror.example.com:8443/ocp");
    expect(Object.keys(JSON.parse(retries[0].mirrorPullSecret).auths)).toEqual(["mirror.example.com:8443"]);
    rerender(<MirroringOperations profiles={[{ id: "p-ui00000082", name: "Planned" }]} selectedJobId="job-attempt" onSelect={onSelect} onOpenProfile={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Result check: Partly verified/)).toBeInTheDocument());
    expect(screen.getByText(/Not OK/)).toBeInTheDocument();
  });

  it("no retry is offered when the cause needs a person", async () => {
    const gone = { ...OPS[0], status: "failed", exitCode: 8, recovery: { classification: "REQUIRE_OWNER_ACTION", eligible: false, requires: ["source content"], text: "An image or layer no longer exists at the source (not found)." } };
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: [gone] });
      if (path === "/api/mirroring/operations/job-run") return Promise.resolve({ operation: gone });
      if (path === "/api/jobs/job-run") return Promise.resolve({ id: "job-run", status: "failed", output: "", metadata_json: "{}" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderOps("job-run");
    const section = (await screen.findByRole("heading", { name: "Mirror to disk", level: 3 })).closest("section");
    await waitFor(() => expect(within(section).getByText(/What to do next: Needs a decision/)).toBeInTheDocument());
    expect(within(section).queryByRole("button", { name: "Run the same again…" })).toBeNull();
  });

  it("elapsed time reads in hours and minutes for long runs", () => {
    const t0 = 1_793_000_000_000;
    expect(elapsed(t0, t0 + 3 * 3600 * 1000 + 25 * 60 * 1000)).toBe("3 h 25 min");
    expect(elapsed(t0, t0 + 59000)).toBe("59 s");
    expect(elapsed(null, t0)).toBe("—");
  });
});

describe("Operations survive navigation and reload", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/build-info") return Promise.resolve({ gitSha: "x", buildTime: "x", repo: "", branch: "" });
      if (path === "/api/update-info") return Promise.resolve({ enabled: false });
      if (path === "/api/mirroring") return Promise.resolve({ profiles: [], activeProfileId: null });
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: OPS });
      const one = path.match(/^\/api\/mirroring\/operations\/([^/]+)$/);
      if (one) return Promise.resolve({ operation: OPS.find((o) => o.jobId === one[1]) });
      const job = path.match(/^\/api\/jobs\/([^/]+)$/);
      if (job) return Promise.resolve({ id: job[1], status: "completed", output: "final output line\n", metadata_json: "{}" });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
  });
  afterEach(() => { cleanup(); sessionStorage.clear(); });

  it("the open view and operation come back after a reload, with the output re-read from the server", async () => {
    const first = render(<MirroringShell onExit={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Operations" }));
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(await screen.findByRole("button", { name: /Prepare transfer\s*Completed/ }));
    await screen.findByRole("heading", { name: "Prepare transfer", level: 3 });
    first.unmount();
    // A reload: component memory is gone, sessionStorage stays, the server is asked again.
    render(<MirroringShell onExit={() => {}} />);
    const section = (await screen.findByRole("heading", { name: "Prepare transfer", level: 3 })).closest("section");
    await waitFor(() => expect(within(section).getByLabelText("Output")).toHaveTextContent("final output line"));
    expect(within(section).getByText("Offline-ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    expect(await screen.findByRole("heading", { name: "No mirroring profiles yet" })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("oaa.mirroring.view.v1"))).toEqual({ view: "profiles", jobId: null });
    await act(async () => {});
  });
});

describe("catalog scans in Operations (v2.2.0 stabilization)", () => {
  const SCAN = {
    jobId: "job-scan-cert", kind: "catalog-scan", status: "failed", title: "Catalog scan — Certified catalog (OpenShift 4.22)",
    message: "The certified catalog could not be fetched and verified: registry.redhat.io refused the credentials (401).",
    profileId: "p-ui00000082", profileName: "Planned", profileExists: true, createdAt: 1793700000000, catalogId: "certified", catalogMinor: "4.22",
    source: "registry.redhat.io/redhat/certified-operator-index:v4.22", packages: null, catalogDigest: null,
    failureReason: "registry.redhat.io refused the credentials (401).", links: [{ label: "Same scan: Red Hat catalog", jobId: "job-scan-rh", at: 1793700000000 }]
  };
  const OK = { ...SCAN, jobId: "job-scan-rh", status: "completed", title: "Catalog scan — Red Hat catalog (OpenShift 4.22)", catalogId: "redhat", packages: 151, catalogDigest: `sha256:${"c".repeat(64)}`, failureReason: null, message: "Completed redhat scan.", links: [] };
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: [SCAN, OK] });
      if (path === "/api/mirroring/operations/job-scan-cert") return Promise.resolve({ operation: SCAN });
      if (path === "/api/mirroring/operations/job-scan-rh") return Promise.resolve({ operation: OK });
      if (path === "/api/jobs/job-scan-cert") return Promise.resolve({ id: "job-scan-cert", status: "failed", output: "Fetching…\nregistry.redhat.io refused the credentials (401).\n", metadata_json: "{}" });
      if (path === "/api/jobs/job-scan-rh") return Promise.resolve({ id: "job-scan-rh", status: "completed", output: "NAME …\n", metadata_json: "{}" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });
  afterEach(cleanup);

  it("a failed catalog scan is listed with a written status and shows its reason, catalog and sibling link — no oc-mirror command or retry", async () => {
    render(<MirroringOperations profiles={[{ id: "p-ui00000082", name: "Planned" }]} selectedJobId="job-scan-cert" onSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Operations" });
    await waitFor(() => expect(within(list).getByRole("button", { name: /Catalog scan — Certified catalog \(OpenShift 4\.22\)\s*Failed/ })).toBeInTheDocument());
    const section = (await screen.findByRole("heading", { name: "Catalog scan — Certified catalog (OpenShift 4.22)", level: 3 })).closest("section");
    expect(within(section).getByRole("alert")).toHaveTextContent("registry.redhat.io refused the credentials (401).");
    expect(within(section).getByText("registry.redhat.io/redhat/certified-operator-index:v4.22")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Same scan: Red Hat catalog" })).toBeInTheDocument();
    expect(within(section).queryByLabelText("oc-mirror command")).toBeNull();
    expect(within(section).queryByRole("button", { name: /Run the same again/ })).toBeNull();
  });

  it("a completed scan shows how many operators the catalog lists and its verified digest", async () => {
    render(<MirroringOperations profiles={[{ id: "p-ui00000082", name: "Planned" }]} selectedJobId="job-scan-rh" onSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    const section = (await screen.findByRole("heading", { name: "Catalog scan — Red Hat catalog (OpenShift 4.22)", level: 3 })).closest("section");
    expect(within(section).getByText("151")).toBeInTheDocument();
    expect(within(section).getByText(/verified over TLS/)).toBeInTheDocument();
  });

  it("an empty list says that catalog scans and checks are listed too, and what is not", async () => {
    vi.mocked(apiFetch).mockImplementation((path) => (path === "/api/mirroring/operations" ? Promise.resolve({ operations: [] }) : Promise.reject(new Error(path))));
    render(<MirroringOperations profiles={[]} selectedJobId={null} onSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    expect(await screen.findByText(/catalog scans and live catalog checks appear here as soon as they start/)).toBeInTheDocument();
    expect(screen.getByText(/Scans started before this version, or on another Architect server, are not listed/)).toBeInTheDocument();
  });
});

describe("View configuration in Operations (replaces the run panel's activity card — R-UX08)", () => {
  afterEach(cleanup);
  it("a run's stored plan opens verified, read-only, from its Operations entry", async () => {
    const PLAN_ID = "plan-20261027T120000Z-abcdef";
    const RUN = { jobId: "job-plan", kind: "run", status: "completed", title: "Mirror to disk", mode: "mirrorToDisk", profileId: "p-ui00000082", profileName: "Planned", profileExists: true, createdAt: 1, exitCode: 0, plan: { planId: PLAN_ID, planSha256: "e".repeat(64), configSha256: "f".repeat(64), kind: "generated" }, links: [] };
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/mirroring/operations") return Promise.resolve({ operations: [RUN] });
      if (path === "/api/mirroring/operations/job-plan") return Promise.resolve({ operation: RUN });
      if (path === "/api/jobs/job-plan") return Promise.resolve({ id: "job-plan", status: "completed", output: "", metadata_json: "{}" });
      if (path === `/api/mirroring/profiles/p-ui00000082/plans/${PLAN_ID}?sha256=${"e".repeat(64)}`) return Promise.resolve({ plan: { planId: PLAN_ID, createdAt: "2026-10-27T12:00:00.000Z", imagesetConfig: { sha256: "f".repeat(64) }, tool: { version: "4.22.0", sha256: "a".repeat(64) } }, imagesetConfig: "kind: ImageSetConfiguration\n" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(<MirroringOperations profiles={[{ id: "p-ui00000082", name: "Planned" }]} selectedJobId="job-plan" onSelect={vi.fn()} onOpenProfile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "View configuration" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("f".repeat(64))).toBeInTheDocument();
    expect(within(dialog).getByLabelText("ImageSetConfiguration stored in this plan")).toHaveTextContent("kind: ImageSetConfiguration");
  });
});
