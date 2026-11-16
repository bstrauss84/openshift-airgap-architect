/**
 * YAML preview per-file Download writes EXPORT-policy bytes, never preview bytes.
 *
 * The preview content carries credentials (the backend forces them in so the
 * reveal toggle can show them). The drawer used to pass that content straight
 * to the Blob it downloaded, so "Show sensitive values" OFF + every credential
 * switch OFF still produced an unredacted file. Now Download asks
 * `fetchExportFile` for the export-policy version, and fails closed — no file —
 * if it cannot get one. The reveal toggle changes display only.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import YamlDrawer from "../src/components/YamlDrawer.jsx";

const PULL = "OAA_SYNTH_CANARY_PULL_DRAWER";
const PREVIEW = `apiVersion: v1
metadata:
  name: drawer
pullSecret: '{"auths":{"quay.io":{"auth":"${PULL}"}}}'
sshKey: ssh-ed25519 AAAAOAASYNTHDRAWER synthetic@example
proxy:
  httpProxy: http://u:OAA_SYNTH_PROXYPASS@proxy.example:3128
`;
const EXPORTED = `apiVersion: v1
metadata:
  name: drawer
pullSecret: '{"auths":{}}'
proxy:
  httpProxy: http://proxy.example:3128/
`;

const props = (extra = {}) => ({
  isOpen: true,
  onClose: vi.fn(),
  previewFiles: { "install-config.yaml": PREVIEW },
  activeStepId: "identity-access",
  scenario: { isAgentBased: false, platform: "Bare Metal", method: "IPI" },
  loading: false,
  error: "",
  ...extra,
});

// jsdom's Blob has no .text(); read it the way a browser API would.
const blobText = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsText(blob);
});

let blobs;
beforeEach(() => {
  blobs = [];
  global.URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return "blob:test"; });
  global.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const downloadButton = () => screen.getAllByRole("button", { name: "Download" })[0];

describe("per-file Download follows the export policy", () => {
  it("display is redacted, and the downloaded bytes are the export-policy bytes", async () => {
    const fetchExportFile = vi.fn(async () => EXPORTED);
    const { container } = render(<YamlDrawer {...props({ fetchExportFile })} />);
    expect(container.textContent).not.toContain(PULL); // redacted on screen
    fireEvent.click(downloadButton());
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(fetchExportFile).toHaveBeenCalledWith("install-config.yaml");
    const text = await blobText(blobs[0]);
    expect(text).toBe(EXPORTED);
    expect(text).not.toContain(PULL);
    expect(text).not.toContain("OAA_SYNTH_PROXYPASS");
    expect(text).not.toContain("OAASYNTHDRAWER");
  });

  it("revealing sensitive values does not change what Download writes", async () => {
    const fetchExportFile = vi.fn(async () => EXPORTED);
    const { container } = render(<YamlDrawer {...props({ fetchExportFile })} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(container.textContent).toContain(PULL); // intentional, visible reveal
    fireEvent.click(downloadButton());
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(await blobText(blobs[0])).toBe(EXPORTED);
  });

  it("fails closed when the export version cannot be produced: no file, a visible reason", async () => {
    const fetchExportFile = vi.fn(async () => { throw new Error("generation failed"); });
    render(<YamlDrawer {...props({ fetchExportFile })} />);
    fireEvent.click(downloadButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/install-config\.yaml was not downloaded: generation failed/));
    expect(blobs).toHaveLength(0);
  });

  it("fails closed without an export callback: never falls back to the preview bytes", async () => {
    render(<YamlDrawer {...props()} />);
    fireEvent.click(downloadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(blobs).toHaveLength(0);
  });

  it("an empty export result downloads nothing", async () => {
    render(<YamlDrawer {...props({ fetchExportFile: async () => "" })} />);
    fireEvent.click(downloadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(blobs).toHaveLength(0);
  });

  it("explains that downloads follow Export Options, not the reveal toggle", () => {
    render(<YamlDrawer {...props({ fetchExportFile: async () => EXPORTED })} />);
    expect(document.querySelector("[data-download-policy-note]").textContent).toMatch(/Export Options on Assets & Guide/);
  });
});
