/**
 * v2.2.0 recovery hardening — "Help me generate" for registry credentials:
 * UTF-8-safe encoding, key normalization, combining with existing entries,
 * no value displayed or kept, and the Mirroring wiring (destination and source).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { encodeBasicAuth, normalizeRegistryKey, buildAuthJson, registriesIn, entryProblems } from "../src/shared/registryAuth.js";
import RegistryCredentialHelper from "../src/components/RegistryCredentialHelper.jsx";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
import { _resetSourceCredentialsForTests } from "../src/mirroring/sourceCredentialSession.js";
beforeEach(() => _resetSourceCredentialsForTests());

const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const PASS = 'pä55:w"rd\\{}€😀';
// Synthetic fixture, computed at run time (no credential-shaped literal in the source).
const RH_AUTH = encodeBasicAuth("rh", "synthetic-token");

describe("building credentials (shared)", () => {
  it("encodes user:password as UTF-8 base64 for any character (window.btoa alone throws on these)", () => {
    expect(() => btoa(`u:${PASS}`)).toThrow();
    expect(decode(encodeBasicAuth("u", PASS))).toBe(`u:${PASS}`);
  });

  it("normalizes registry keys without redirecting them", () => {
    expect(normalizeRegistryKey(" https://Mirror.Example.com:8443/ ")).toBe("mirror.example.com:8443");
    expect(normalizeRegistryKey("mirror.example.com:8443/ocp")).toBe("mirror.example.com:8443/ocp");
    expect(normalizeRegistryKey("user:pw@quay.io")).toBeNull();
    expect(entryProblems({ registry: "https://u:p@x.io", username: "a:b", password: "" })).toEqual({
      registry: expect.stringMatching(/no user name, password/), username: "A user name cannot contain a colon.", password: "Enter the password or access token."
    });
  });

  it("combines with existing entries only when asked, and refuses a registry that would change account", () => {
    const existing = JSON.stringify({ auths: { "registry.redhat.io": { auth: RH_AUTH } } });
    const fresh = JSON.parse(buildAuthJson([{ registry: "quay.io", username: "bot", password: PASS }], { existing }));
    expect(Object.keys(fresh.auths)).toEqual(["quay.io"]);
    const kept = JSON.parse(buildAuthJson([{ registry: "quay.io", username: "bot", password: PASS }], { existing, keepExisting: true }));
    expect(Object.keys(kept.auths)).toEqual(["registry.redhat.io", "quay.io"]);
    expect(kept.auths["registry.redhat.io"].auth).toBe(RH_AUTH);
    expect(() => buildAuthJson([{ registry: "registry.redhat.io", username: "x", password: "y" }], { existing, keepExisting: true })).toThrow(/already in the field with different credentials/);
    expect(() => buildAuthJson([{ registry: "a.io", username: "x", password: "y" }, { registry: "https://A.io/", username: "z", password: "w" }])).toThrow(/listed twice/);
    expect(registriesIn(existing)).toEqual(["registry.redhat.io"]);
    expect(registriesIn("not json")).toBeNull();
  });
});

describe("the dialog", () => {
  afterEach(cleanup);
  const open = (props = {}) => {
    const onUse = vi.fn();
    const onClose = vi.fn();
    const utils = render(<RegistryCredentialHelper isOpen idPrefix="t" title="Destination registry credentials" purpose="For the destination." onUse={onUse} onClose={onClose} {...props} />);
    return { ...utils, onUse, onClose };
  };

  it("no error until a field is left or Use is pressed; the password is masked and never displayed; the result is valid auth JSON", () => {
    const { onUse, container } = open({ defaultRegistry: "mirror.example.com:8443" });
    expect(container.querySelectorAll(".field-error")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Use these credentials" }));
    expect(screen.getByText(/Enter the user name/)).toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
    const pw = screen.getByLabelText(/Password or token/);
    expect(pw).toHaveAttribute("type", "password");
    // Credentials for another system, not an Architect login: "off", not "new-password" (owner A, 2026-11-03).
    expect(pw).toHaveAttribute("autocomplete", "off");
    fireEvent.change(screen.getByLabelText(/User name/), { target: { value: "dst-user" } });
    fireEvent.change(pw, { target: { value: PASS } });
    expect(screen.getByRole("status")).toHaveTextContent("Will use: mirror.example.com:8443 as dst-user.");
    expect(document.body.textContent.includes(PASS)).toBe(false);
    expect(document.body.textContent.includes(encodeBasicAuth("dst-user", PASS))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Use these credentials" }));
    const json = JSON.parse(onUse.mock.calls[0][0]);
    expect(decode(json.auths["mirror.example.com:8443"].auth)).toBe(`dst-user:${PASS}`);
  });

  it("several registries, keeping the field's existing ones explicitly", () => {
    const existing = JSON.stringify({ auths: { "registry.redhat.io": { auth: RH_AUTH } } });
    const { onUse } = open({ existing });
    fireEvent.change(screen.getByLabelText(/Registry address/), { target: { value: "quay.io" } });
    fireEvent.change(screen.getByLabelText(/User name/), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/Password or token/), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Add another registry" }));
    const second = screen.getAllByRole("group").at(-1);
    fireEvent.change(within(second).getByLabelText(/Registry address/), { target: { value: "registry.example.com:5000" } });
    fireEvent.change(within(second).getByLabelText(/User name/), { target: { value: "c" } });
    fireEvent.change(within(second).getByLabelText(/Password or token/), { target: { value: "d" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Keep the registries already in the field \(registry\.redhat\.io\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use these credentials" }));
    expect(Object.keys(JSON.parse(onUse.mock.calls[0][0]).auths)).toEqual(["registry.redhat.io", "quay.io", "registry.example.com:5000"]);
  });

  it("closing forgets what was typed", () => {
    const onUse = vi.fn();
    const { rerender } = render(<RegistryCredentialHelper isOpen idPrefix="t" title="T" purpose="P" onUse={onUse} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Password or token/), { target: { value: "secret-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<RegistryCredentialHelper isOpen={false} idPrefix="t" title="T" purpose="P" onUse={onUse} onClose={() => {}} />);
    rerender(<RegistryCredentialHelper isOpen idPrefix="t" title="T" purpose="P" onUse={onUse} onClose={() => {}} />);
    expect(screen.getByLabelText(/Password or token/)).toHaveValue("");
    expect(onUse).not.toHaveBeenCalled();
  });
});

describe("in the Mirroring run panel", () => {
  let bodies;
  beforeEach(() => {
    bodies = [];
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
      if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
      if (path.startsWith("/api/mirroring/storage")) return Promise.resolve({ configured: { base: "/d", source: "default", ok: true }, profile: { base: "/d", source: "default", ok: true, paths: { archivePath: "/d/a", workspacePath: "/d/w", cachePath: "/d/c", receivedPath: "/d/r" } } });
      if (/\/preflight$/.test(path)) { bodies.push(JSON.parse(opts.body)); return Promise.resolve({ ok: false, blockers: ["x"], warnings: [], items: [] }); }
      if (/^\/api\/mirroring\/profiles\/[^/]+$/.test(path) && opts.method === "POST") return Promise.resolve(profile);
      return Promise.reject(new Error(`unexpected ${opts.method || "GET"} ${path}`));
    });
  });
  afterEach(cleanup);
  const profile = {
    id: "p-ui00000091", name: "P", updatedAt: 1, kind: "planned", content: { platform: false, operators: false, additionalImages: true },
    platform: { release: {}, version: {} }, operators: { catalogMinor: null, selected: [] }, additionalImages: [{ id: "i", name: "quay.io/a/b:1", source: "user" }],
    options: {}, execution: { mode: "mirrorToMirror", registryUrl: "mirror.example.com:8443/ocp", options: {} }, history: [], transfers: [], received: [], readiness: [],
    paths: { root: "/d", archivePath: "/d/a", workspacePath: "/d/w", cachePath: "/d/c", receivedPath: "/d/r" }
  };

  it("Help me generate is offered for the destination registry only; the Red Hat pull secret keeps its console link (owner decision 2026-11-03)", async () => {
    render(<MirroringRunPanel profile={profile} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    const creds = (await screen.findByRole("heading", { name: "Credentials and destination for this run" })).closest("section");
    const helpers = within(creds).getAllByRole("button", { name: "Help me generate" });
    expect(helpers).toHaveLength(1);
    expect(within(creds).getByRole("link", { name: /Red Hat pull secret/ })).toHaveAttribute("href", "https://console.redhat.com/openshift/install/pull-secret");
    fireEvent.click(helpers[0]);
    const dialog = await screen.findByRole("dialog", { name: "Destination registry credentials" });
    expect(within(dialog).getByLabelText(/Registry address/)).toHaveValue("mirror.example.com:8443");
    fireEvent.change(within(dialog).getByLabelText(/User name/), { target: { value: "pusher" } });
    fireEvent.change(within(dialog).getByLabelText(/Password or token/), { target: { value: PASS } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use these credentials" }));
    // The source pull secret is pasted (or uploaded) as downloaded; it goes to the server separately.
    const source = within(creds).getByRole("textbox", { name: /pull secret/i });
    fireEvent.change(source, { target: { value: JSON.stringify({ auths: { "registry.redhat.io": { auth: RH_AUTH } } }) } });
    fireEvent.blur(source);
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const b = bodies[0];
    expect(Object.keys(JSON.parse(b.mirrorPullSecret).auths)).toEqual(["mirror.example.com:8443"]);
    expect(decode(JSON.parse(b.mirrorPullSecret).auths["mirror.example.com:8443"].auth)).toBe(`pusher:${PASS}`);
    expect(Object.keys(JSON.parse(b.rhPullSecret).auths)).toEqual(["registry.redhat.io"]);
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });

  it("mirror to disk offers a full transfer (sent as fullBaseline); other workflows do not", async () => {
    render(<MirroringRunPanel profile={profile} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    await screen.findByRole("heading", { name: "Credentials and destination for this run" });
    expect(screen.queryByRole("switch", { name: "Full transfer" })).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Workflow" })).getByRole("button", { name: /^Mirror to disk/ }));
    const sw = await screen.findByRole("switch", { name: "Full transfer" });
    expect(screen.getByText(/must load every transfer, in order/)).toBeInTheDocument();
    fireEvent.click(sw);
    fireEvent.click(screen.getByRole("button", { name: "Run preflight" }));
    await waitFor(() => expect(bodies.at(-1)?.fullBaseline).toBe(true));
  });
});


describe("no 'save password?' invitation (owner A, 2026-11-03)", () => {
  afterEach(cleanup);
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Registry address/), { target: { value: "mirror.example.com:8443" } });
    fireEvent.change(screen.getByLabelText(/User name/), { target: { value: "pusher" } });
    fireEvent.change(screen.getByLabelText(/Password or token/), { target: { value: "s3cret-token" } });
  };
  it("a real form with autocomplete=off; masked password; Enter submits; the fields are empty in the DOM before the dialog closes", () => {
    let valuesAtClose = null;
    const onUse = vi.fn();
    const onClose = () => { valuesAtClose = [screen.getByLabelText(/User name/).value, screen.getByLabelText(/Password or token/).value]; };
    render(<RegistryCredentialHelper isOpen idPrefix="a" title="Destination registry credentials" purpose="P" onUse={onUse} onClose={onClose} />);
    const form = screen.getByLabelText(/Password or token/).closest("form");
    expect(form).toHaveAttribute("autocomplete", "off");
    for (const label of [/User name/, /Password or token/, /Registry address/]) {
      const el = screen.getByLabelText(label);
      expect(el).toHaveAttribute("autocomplete", "off");
      expect(el).toHaveAttribute("data-lpignore", "true");
      expect(el).toHaveAttribute("data-1p-ignore", "true");
    }
    expect(screen.getByLabelText(/Password or token/)).toHaveAttribute("type", "password");
    fill();
    fireEvent.submit(form); // Enter in any field
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0][1]).toEqual({ registries: ["mirror.example.com:8443"] });
    expect(valuesAtClose).toEqual(["", ""]);
  });

  it("Cancel empties the fields first and never hands anything over", () => {
    let valuesAtClose = null;
    const onUse = vi.fn();
    const onClose = () => { valuesAtClose = screen.getByLabelText(/Password or token/).value; };
    render(<RegistryCredentialHelper isOpen idPrefix="b" title="T" purpose="P" onUse={onUse} onClose={onClose} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onUse).not.toHaveBeenCalled();
    expect(valuesAtClose).toBe("");
  });
});
