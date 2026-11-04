/**
 * v2.2.0 M2 — Mirroring workflow behaviour (rendered, with a stateful fake
 * backend behind apiFetch).
 *
 * Covers: landing entry; Mirroring rendering with no Install store at all;
 * loading / empty / error states; profile create, select, persist across a
 * remount; the validation contract (no red on untouched fields, errors after
 * blur or Continue); every combination of the three content cards; non-
 * destructive deselection; version controls only for platform content; the
 * shared release selector writing ONLY the profile; per-profile lock; and that
 * no profile write carries a credential.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import MirroringShell from "../src/mirroring/MirroringShell.jsx";
import LandingPage from "../src/LandingPage.jsx";
import { VersionSupportGate } from "../src/App.jsx";
import { AppContext } from "../src/store.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

/* ---------------- stateful fake of the M1 server ---------------- */
let server;
const newServer = () => ({
  activeProfileId: null,
  profiles: {},
  seq: 0,
  writes: [],
  failGet: false
});
const describeP = (p) => ({ ...p, paths: { archivePath: `/data/oc-mirror/profiles/${p.id}/archives`, workspacePath: `/data/oc-mirror/profiles/${p.id}/workspace`, cachePath: `/data/oc-mirror/profiles/${p.id}/cache` }, warnings: [], readiness: [] });
const slice = () => ({ _schema: 1, activeProfileId: server.activeProfileId, profiles: Object.values(server.profiles).map(describeP) });
const merge = (p, body) => ({
  ...p,
  ...(body.name !== undefined ? { name: body.name } : {}),
  content: { ...p.content, ...(body.content || {}) },
  platform: body.platform ? {
    ...p.platform,
    release: { ...p.platform.release, ...(body.platform.release || {}) },
    version: { ...p.platform.version, ...(body.platform.version || {}) }
  } : p.platform
});

function fakeApi(path, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  // M5 run panel reads (not writes): the profile's run history and the mounted-secret check.
  if (method === "GET" && /^\/api\/mirroring\/profiles\/[^/]+\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
  if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
  if (path.startsWith("/api/mirroring")) server.writes.push({ path, method, body });
  if (path === "/api/mirroring" && method === "GET") {
    return server.failGet ? Promise.reject(new Error("backend unreachable")) : Promise.resolve(slice());
  }
  if (path === "/api/mirroring/profiles" && method === "POST") {
    const id = `p-fake${String(++server.seq).padStart(8, "0")}`;
    server.profiles[id] = merge({ id, name: "", content: { platform: false, operators: false, additionalImages: false }, platform: { release: { channel: null, patchVersion: null, confirmed: false }, version: { locked: false } }, operators: { catalogMinor: null, selected: [] }, additionalImages: [], history: [] }, body);
    server.activeProfileId = id;
    return Promise.resolve(describeP(server.profiles[id]));
  }
  if (path === "/api/mirroring/active" && method === "POST") {
    server.activeProfileId = body.profileId;
    return Promise.resolve(slice());
  }
  const m = path.match(/^\/api\/mirroring\/profiles\/([^/]+)(\/lock|\/unlock)?$/);
  if (m) {
    const p = server.profiles[decodeURIComponent(m[1])];
    if (m[2] === "/lock") {
      p.platform = { ...p.platform, release: { ...p.platform.release, confirmed: true }, version: { ...p.platform.version, locked: true, selectedMinor: p.platform.release.channel, selectedPatch: p.platform.release.patchVersion } };
      return Promise.resolve(describeP(p));
    }
    if (m[2] === "/unlock") {
      p.platform = { ...p.platform, release: { ...p.platform.release, confirmed: false }, version: { ...p.platform.version, locked: false } };
      return Promise.resolve(describeP(p));
    }
    if (method === "POST") {
      server.profiles[p.id] = merge(p, body);
      return Promise.resolve(describeP(server.profiles[p.id]));
    }
    if (method === "DELETE") {
      delete server.profiles[p.id];
      if (server.activeProfileId === p.id) server.activeProfileId = null;
      return Promise.resolve({ ok: true });
    }
  }
  if (path === "/api/cincinnati/channels") return Promise.resolve({ channels: ["4.22", "4.21", "4.20", "4.23"] });
  if (path === "/api/cincinnati/update") return Promise.resolve({ channels: [] });
  if (path.startsWith("/api/cincinnati/patches")) return Promise.resolve({ versions: ["4.22.16", "4.22.15"] });
  return Promise.reject(new Error(`unexpected ${method} ${path}`));
}

const cincinnatiCalls = () => vi.mocked(apiFetch).mock.calls.filter(([p]) => String(p).startsWith("/api/cincinnati"));

beforeEach(() => {
  server = newServer();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(fakeApi);
});
afterEach(() => {
  cleanup();
  document.body.removeAttribute("data-theme");
});

const renderShell = (onExit = () => {}) => render(<MirroringShell onExit={onExit} />);

const createFirstProfile = async () => {
  renderShell();
  fireEvent.click(await screen.findByRole("button", { name: "New profile" }));
  return screen.findByRole("heading", { name: "What would you like to mirror?" });
};

const card = (title) => screen.getByRole("button", { name: new RegExp(`^${title}`) });

/* ---------------- tests ---------------- */

describe("landing and gate entry points", () => {
  it("the Mirroring card is an enabled button; Upgrade is still Coming soon; Install unchanged", () => {
    const onStartMirroring = vi.fn();
    render(<LandingPage hasProgress={false} onStartInstall={() => {}} onStartMirroring={onStartMirroring} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mirroring" }));
    expect(onStartMirroring).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Start new install →" })).toBeTruthy();
    expect(screen.getByText("Upgrade").closest(".landing-card").getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("Operator mirroring")).toBeNull();
  });

  it("an unsupported Install minor still offers a way into Mirroring", () => {
    const onOpenMirroring = vi.fn();
    const state = { version: { selectedMinor: "4.23" }, release: { channel: "4.23" } };
    render(
      <AppContext.Provider value={{ state, updateState: vi.fn(), startOver: vi.fn(), loading: false }}>
        <VersionSupportGate onOpenMirroring={onOpenMirroring}><div>wizard</div></VersionSupportGate>
      </AppContext.Provider>
    );
    expect(screen.queryByText("wizard")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to 4.22" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Mirroring" }));
    expect(onOpenMirroring).toHaveBeenCalledTimes(1);
  });
});

describe("Mirroring shell states", () => {
  it("renders with no Install store at all, shows loading then the empty state", async () => {
    renderShell();
    expect(screen.getByRole("status").textContent).toMatch(/Loading mirroring profiles/);
    expect(await screen.findByRole("heading", { name: "No mirroring profiles yet" })).toBeTruthy();
    expect(cincinnatiCalls()).toHaveLength(0);
  });

  it("shows a recoverable error when profiles cannot be loaded", async () => {
    server.failGet = true;
    renderShell();
    expect(await screen.findByRole("heading", { name: "Could not load mirroring profiles" })).toBeTruthy();
    server.failGet = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "No mirroring profiles yet" })).toBeTruthy();
  });

  it("Home (in the shared Tools drawer) leaves Mirroring without resetting anything", async () => {
    const onExit = vi.fn();
    renderShell(onExit);
    await screen.findByRole("heading", { name: "No mirroring profiles yet" });
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull(); // no duplicate header control
    fireEvent.click(screen.getByRole("button", { name: "Open Tools" }));
    const drawer = screen.getByRole("dialog", { name: "Tools" });
    expect(within(drawer).queryByRole("button", { name: "Start Over" })).toBeNull(); // Install-only action
    fireEvent.click(within(drawer).getByRole("button", { name: "Home" }));
    expect(onExit).toHaveBeenCalled();
    expect(server.writes.some((w) => w.path.includes("start-over"))).toBe(false);
  });
});

describe("validation contract", () => {
  it("an untouched form shows no errors; errors appear after blur or Continue", async () => {
    await createFirstProfile();
    expect(document.querySelectorAll(".field-error")).toHaveLength(0);
    const nameInput = screen.getByRole("textbox", { name: /Profile name/ });
    expect(nameInput.getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(nameInput, { target: { value: "" } });
    expect(document.querySelectorAll(".field-error")).toHaveLength(0); // typing is not a blur
    fireEvent.blur(nameInput);
    expect(screen.getByText("Enter a profile name.")).toBeTruthy();
    expect(screen.queryByText(/Select at least one content type/)).toBeNull(); // content untouched

    fireEvent.change(nameInput, { target: { value: "Edge site" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Select at least one content type/)).toBeTruthy();
    expect(server.writes.filter((w) => w.method === "POST" && /\/profiles\/[^/]+$/.test(w.path))).toHaveLength(0);
  });
});

describe("content selection", () => {
  const combos = [];
  for (let i = 1; i < 8; i++) combos.push([Boolean(i & 1), Boolean(i & 2), Boolean(i & 4)]);

  it.each(combos)("platform=%s operators=%s images=%s can be selected, saved and reflected", async (platform, operators, images) => {
    await createFirstProfile();
    const want = { "OpenShift platform": platform, Operators: operators, "Additional images": images };
    for (const [title, on] of Object.entries(want)) {
      if (on) fireEvent.click(card(title));
      expect(card(title).getAttribute("aria-pressed")).toBe(String(on));
    }
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Change name or content" });
    const patch = server.writes.find((w) => w.method === "POST" && /\/profiles\/[^/]+$/.test(w.path));
    expect(patch.body.content).toEqual({ platform, operators, additionalImages: images });
    // Version controls appear only for platform content (in its tab, possibly not the open one — R-UX01).
    expect(Boolean(screen.queryByRole("combobox", { name: "Minor channel", hidden: true }))).toBe(platform);
    expect(Boolean(screen.queryByRole("heading", { name: "Operators", hidden: true }))).toBe(operators);
    expect(Boolean(screen.queryByRole("heading", { name: "Additional images", hidden: true }))).toBe(images);
    // One tab per selected content type plus Run & transfers; a single type gets Content | Run & transfers.
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent.replace(/ · \d+ to fix$/, ""));
    const count = [platform, operators, images].filter(Boolean).length;
    if (count === 1) expect(tabs).toEqual(["Content", "Run & transfers"]);
    else {
      expect(tabs.at(-1)).toBe("Run & transfers");
      expect(tabs.some((t) => t === "Platform")).toBe(platform);
      expect(tabs.some((t) => /^Operators · \d+$/.test(t))).toBe(operators);
      expect(tabs.some((t) => /^Additional images · \d+$/.test(t))).toBe(images);
    }
  });

  it("additional-images-only needs and fetches no OpenShift version", async () => {
    await createFirstProfile();
    fireEvent.click(card("Additional images"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Change name or content" });
    expect(screen.queryByRole("combobox", { name: "Minor channel" })).toBeNull();
    expect(cincinnatiCalls()).toHaveLength(0);
    expect(screen.getByText(/No OpenShift version is needed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
  });

  it("keyboard: cards are buttons with aria-pressed and toggle with Enter/Space semantics", async () => {
    await createFirstProfile();
    const c = card("Operators");
    expect(c.tagName).toBe("BUTTON");
    expect(c.getAttribute("type")).toBe("button");
    expect(c.getAttribute("aria-describedby")).toBe("mirroring-content-desc-operators");
    c.focus();
    expect(document.activeElement).toBe(c);
    fireEvent.click(c); // native button: Enter and Space dispatch click
    expect(c.getAttribute("aria-pressed")).toBe("true");
    expect(within(c).getByText("✓ Selected")).toBeTruthy();
  });

  it("deselecting a saved type says its settings are kept and does not clear them", async () => {
    await createFirstProfile();
    fireEvent.click(card("OpenShift platform"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("combobox", { name: "Minor channel" });
    await waitFor(() => expect(server.profiles[server.activeProfileId].platform.release.patchVersion).toBe("4.22.16"), { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Change name or content" }));
    fireEvent.click(card("OpenShift platform"));
    fireEvent.click(card("Additional images"));
    expect(screen.getByRole("status", { name: "" }).textContent || "").toBeDefined();
    expect(screen.getByText(/OpenShift platform settings are kept in this profile/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Change name or content" });
    const stored = server.profiles[server.activeProfileId];
    expect(stored.content.platform).toBe(false);
    expect(stored.platform.release.patchVersion).toBe("4.22.16");
  });
});

describe("profiles", () => {
  it("selection is saved on the server and survives a remount (reload)", async () => {
    await createFirstProfile();
    fireEvent.click(card("Operators"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Change name or content" });
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    await screen.findByRole("heading", { name: "What would you like to mirror?" });
    const [first] = Object.keys(server.profiles);
    fireEvent.click(screen.getByRole("button", { name: /^Mirroring profile 1/ }));
    await waitFor(() => expect(server.activeProfileId).toBe(first));
    cleanup();
    renderShell();
    const opened = await screen.findByRole("button", { name: /^Mirroring profile 1/ });
    expect(opened.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Mirroring profile 1" })).toBeTruthy();
  });

  it("delete asks for confirmation and states that data on disk is kept", async () => {
    await createFirstProfile();
    fireEvent.click(card("Operators"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete profile" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/is not deleted/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete profile" }));
    expect(await screen.findByRole("heading", { name: "No mirroring profiles yet" })).toBeTruthy();
  });

  it("no profile write ever carries a credential", async () => {
    await createFirstProfile();
    fireEvent.click(card("OpenShift platform"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("combobox", { name: "Minor channel" });
    await waitFor(() => expect(server.writes.filter((w) => w.method === "POST" && /\/profiles\/[^/]+$/.test(w.path)).length).toBeGreaterThan(1), { timeout: 3000 });
    const serialized = JSON.stringify(server.writes);
    expect(serialized).not.toMatch(/pullSecret|password|auths|token|credential/i);
  });
});

describe("shared release selector inside a profile", () => {
  const openPlatformProfile = async () => {
    await createFirstProfile();
    fireEvent.click(card("OpenShift platform"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    return screen.findByRole("combobox", { name: "Minor channel" });
  };

  it("offers only supported minors, auto-loads patches and saves only platform release/version", async () => {
    const minor = await openPlatformProfile();
    const options = Array.from(minor.querySelectorAll("option")).map((o) => o.value).filter(Boolean);
    expect(options).toEqual(["4.22", "4.21", "4.20"]);
    expect(screen.getByRole("alert").textContent).toMatch(/4\.23 is available upstream but not yet supported/);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Patch version" }).value).toBe("4.22.16"));
    await waitFor(() => expect(server.profiles[server.activeProfileId].platform.release.patchVersion).toBe("4.22.16"), { timeout: 3000 });
    const releasePatches = server.writes.filter((w) => w.method === "POST" && /\/profiles\/[^/]+$/.test(w.path) && w.body.platform);
    for (const w of releasePatches) {
      expect(Object.keys(w.body)).toEqual(["platform"]);
      expect(Object.keys(w.body.platform).sort()).toEqual(["release", "version"]);
      expect(w.body.platform.version.locked).toBeUndefined();
      expect(w.body.platform.release.confirmed).toBeUndefined();
    }
  });

  it("Lock release locks this profile only; Unlock reopens it; locked selectors are disabled", async () => {
    await openPlatformProfile();
    const lock = await screen.findByRole("button", { name: "Lock release" });
    await waitFor(() => expect(lock.disabled).toBe(false));
    await act(async () => { fireEvent.click(lock); });
    const unlock = await screen.findByRole("button", { name: "Unlock release" });
    expect(screen.getByRole("combobox", { name: "Minor channel" }).disabled).toBe(true);
    expect(screen.getByRole("combobox", { name: "Patch version" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Update" }).disabled).toBe(true);
    expect(screen.getByText(/Release 4\.22\.16 is locked for this profile/)).toBeTruthy();
    expect(server.writes.some((w) => w.path.endsWith("/lock"))).toBe(true);
    await act(async () => { fireEvent.click(unlock); });
    expect(await screen.findByRole("button", { name: "Lock release" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Minor channel" }).disabled).toBe(false);
  });
});
