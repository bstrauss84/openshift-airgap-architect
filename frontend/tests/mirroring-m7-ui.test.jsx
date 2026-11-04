/**
 * v2.2.0 M7 UI follow-up: bulk additional images (paste / file / drag), and
 * the transfer explanation — no receive card on a connected-side profile, a
 * link that explains and receives for the "same Architect travels" case.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { parseImageList } from "../src/shared/imageList.js";
import AdditionalImagesEditor, { validateImageRef } from "../src/mirroring/AdditionalImagesEditor.jsx";
import MirroringRunPanel from "../src/mirroring/MirroringRunPanel.jsx";
import { ReceiveTransferForm } from "../src/mirroring/HighSideControls.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const parse = (text, existing = []) => parseImageList(text, { validate: validateImageRef, existing });

describe("reading a list of images", () => {
  it("plain lines, YAML list items, ImageSetConfiguration entries, quotes and comments", () => {
    const r = parse([
      "quay.io/org/app:v1",
      "  - registry.example.com/team/tool:2.0   # pinned later",
      "- name: quay.io/org/other:3",
      "    - name: \"quay.io/org/quoted:4\"",
      "image: 'registry.example.com:5000/x/y@sha256:" + "a".repeat(64) + "'",
      "# a whole comment line",
      "",
      "additionalImages:",
      "apiVersion: mirror.openshift.io/v2alpha1",
      "---"
    ].join("\n"));
    expect(r.images).toEqual([
      "quay.io/org/app:v1",
      "registry.example.com/team/tool:2.0",
      "quay.io/org/other:3",
      "quay.io/org/quoted:4",
      `registry.example.com:5000/x/y@sha256:${"a".repeat(64)}`
    ]);
    expect(r.ignored).toBe(3);
    expect(r.invalid).toEqual([]);
  });
  it("duplicates (within the list and against the profile) are skipped; invalid lines say why, with their line number", () => {
    const r = parse("quay.io/a/b:1\nquay.io/a/b:1\nquay.io/c/d:1\nnot an image\nquay.io/no-tag\n", ["quay.io/c/d:1"]);
    expect(r.images).toEqual(["quay.io/a/b:1"]);
    expect(r.duplicates).toEqual(["quay.io/a/b:1", "quay.io/c/d:1"]);
    expect(r.invalid.map((p) => [p.line, p.reason])).toEqual([
      [4, "Only one image per line."],
      [5, "Add a :tag or an @sha256: digest so the exact image is known."]
    ]);
  });
  it("Windows line endings", () => {
    expect(parse("quay.io/a/b:1\r\nquay.io/a/c:2\r\n").images).toEqual(["quay.io/a/b:1", "quay.io/a/c:2"]);
  });
});

describe("Add several images", () => {
  let saved;
  beforeEach(() => {
    saved = null;
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (opts.method === "POST") { saved = JSON.parse(opts.body); return Promise.resolve({ id: "p-1", additionalImages: saved.additionalImages }); }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });
  afterEach(cleanup);
  const profile = { id: "p-ui00000071", additionalImages: [{ id: "img-aaaa", name: "quay.io/org/existing:1", source: "user" }] };

  it("pasted list: preview first, nothing added until confirmed, then new valid images become rows and are saved", async () => {
    render(<AdditionalImagesEditor profile={profile} onProfileChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add several…" }));
    const dialog = await screen.findByRole("dialog");
    // Keeps the shared dialog panel (background, padding) — Modal's className replaces "modal".
    expect(dialog.querySelector(".modal.mirroring-bulk-modal")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Add images" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Images, one per line/ }), {
      target: { value: "- quay.io/org/existing:1\n- name: quay.io/org/new:2\n- quay.io/org/third:3\nadditionalImages:\nbad line here" }
    });
    const summary = within(dialog).getByRole("status");
    expect(summary).toHaveTextContent("2 new image(s) will be added");
    expect(summary).toHaveTextContent("1 already in this profile (skipped)");
    expect(summary).toHaveTextContent("1 YAML line(s) that are not images (ignored)");
    expect(summary).toHaveTextContent("1 line(s) not added");
    expect(within(dialog).getByText(/Line 5:/)).toBeInTheDocument();
    expect(saved).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 image(s)" }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved.additionalImages.map((i) => i.name)).toEqual(["quay.io/org/existing:1", "quay.io/org/new:2", "quay.io/org/third:3"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: /Image 3/ })).toHaveValue("quay.io/org/third:3");
  });

  it("a dropped file is read into the list", async () => {
    render(<AdditionalImagesEditor profile={profile} onProfileChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add several…" }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("textbox", { name: /Images, one per line/ });
    const file = new File(["quay.io/x/y:1\nquay.io/x/z:2\n"], "images.txt", { type: "text/plain" });
    fireEvent.drop(box, { dataTransfer: { files: [file], getData: () => "" } });
    await waitFor(() => expect(box.value).toContain("quay.io/x/z:2"));
    expect(within(dialog).getByRole("status")).toHaveTextContent("2 new image(s) will be added");
  });

  it("Cancel adds nothing", async () => {
    render(<AdditionalImagesEditor profile={profile} onProfileChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add several…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Images, one per line/ }), { target: { value: "quay.io/a/b:1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(saved).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Image 2/ })).toBeNull();
  });
});

describe("transfer: explained, and only where it applies", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === "/api/secrets/rh-pull-secret") return Promise.resolve({ available: false });
      if (/\/runs$/.test(path)) return Promise.resolve({ runs: [], activeVerification: null });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });
  afterEach(cleanup);
  const paths = { root: "/d/p", archivePath: "/d/p/archives", workspacePath: "/d/p/ws", cachePath: "/d/p/cache", receivedPath: "/d/p/received" };
  const planned = {
    id: "p-ui00000072", name: "Planned", updatedAt: 1, kind: "planned",
    content: { platform: false, operators: false, additionalImages: true }, platform: { release: {}, version: {} }, operators: { catalogMinor: null, selected: [] },
    additionalImages: [{ id: "img-aaaa", name: "quay.io/a/b:1", source: "user" }], options: {}, execution: { mode: "mirrorToDisk", registryUrl: "", options: {} },
    history: [], transfers: [], received: [], readiness: [], paths
  };

  it("a connected-side profile has no receive card; the link opens a dialog that explains what a transfer is", async () => {
    render(<MirroringRunPanel profile={planned} onProfileChanged={vi.fn()} onProfilesChanged={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: /Receive a/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Transfer folder|Transfer directory/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Receive a transfer here…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/The archives plus these files are the transfer/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Disk to mirror can only load a transfer that has been received/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Transfer directory/ })).toBeInTheDocument();
  });

  it("an empty folder field is flagged only when receiving is attempted, not when the field is merely left", () => {
    const { container } = render(<ReceiveTransferForm idPrefix="t7" onReceived={vi.fn()} />);
    const dir = screen.getByRole("textbox", { name: /Transfer directory/ });
    fireEvent.focus(dir); fireEvent.blur(dir);
    expect(container.querySelectorAll(".field-error")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Verify and receive" }));
    expect(screen.getByText("Name the directory that holds the transfer.")).toBeInTheDocument();
  });
});
