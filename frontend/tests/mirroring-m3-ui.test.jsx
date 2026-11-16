/**
 * v2.2.0 M3 — additional image rows and the profile YAML preview.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import AdditionalImagesEditor, { validateImageRef } from "../src/mirroring/AdditionalImagesEditor.jsx";
import MirroringShell from "../src/mirroring/MirroringShell.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

afterEach(cleanup);

describe("image reference validation", () => {
  it.each([
    ["quay.io/org/app:v1", ""],
    ["registry.example.com/a/b@sha256:abcd", ""],
    ["quay.io/org/app", /:tag or an @sha256: digest/],
    ["app:v1", /registry or repository path/],
    ["quay.io/org/app:v1; rm -rf /", /without spaces or quotes/]
  ])("%s", (ref, want) => {
    const msg = validateImageRef(ref);
    if (want === "") expect(msg).toBe("");
    else expect(msg).toMatch(want);
  });
});

describe("additional image rows", () => {
  let writes;
  const profile = (images = []) => ({ id: "p-img", name: "img", updatedAt: 1, content: { additionalImages: true }, additionalImages: images });
  function Host({ images }) {
    const [p, setP] = useState(profile(images));
    return <AdditionalImagesEditor profile={p} onProfileChanged={setP} />;
  }
  beforeEach(() => {
    writes = [];
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      const body = JSON.parse(opts.body);
      writes.push(body);
      return Promise.resolve({ ...profile(body.additionalImages), updatedAt: Date.now() });
    });
  });

  it("a new row is not red until left; invalid rows are kept and not saved; valid rows save with identity and owner", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const input = screen.getByRole("textbox", { name: /Image 1/ });
    expect(document.querySelectorAll(".field-error")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "quay.io/org/app" } });
    fireEvent.blur(input);
    expect(screen.getByText(/:tag or an @sha256: digest/)).toBeTruthy();
    expect(input.value).toBe("quay.io/org/app"); // kept, not discarded
    expect(writes).toHaveLength(0);
    fireEvent.change(input, { target: { value: "quay.io/org/app:v1" } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].additionalImages).toEqual([{ id: expect.stringMatching(/^img-/), name: "quay.io/org/app:v1", source: "user" }]);
  });

  it("duplicates are reported; removing a row saves the remaining list", async () => {
    render(<Host images={[{ id: "img-aaaa1111", name: "quay.io/a/b:1", source: "user" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const second = screen.getByRole("textbox", { name: /Image 2/ });
    fireEvent.change(second, { target: { value: "quay.io/a/b:1" } });
    fireEvent.blur(second);
    expect(screen.getByText("This image is already in the list.")).toBeTruthy();
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove image 2" }));
    await waitFor(() => expect(writes).toHaveLength(0)); // list unchanged from saved → no write
    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    await waitFor(() => expect(writes.at(-1).additionalImages).toEqual([]));
  });

  it("editing a suggested (non-user) row marks it user-modified so automation can never overwrite it", async () => {
    render(<Host images={[{ id: "img-sugg0001", name: "quay.io/vendor/disk:9", source: "operator:kubevirt-hyperconverged" }]} />);
    expect(screen.getByText(/Suggested by operator:kubevirt-hyperconverged/)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: /Image 1/ });
    fireEvent.change(input, { target: { value: "quay.io/vendor/disk:10" } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].additionalImages[0]).toEqual({ id: "img-sugg0001", name: "quay.io/vendor/disk:10", source: "operator:kubevirt-hyperconverged", userModified: true });
  });
});

describe("profile YAML preview drawer", () => {
  let slice;
  const yamlFor = (id) => `apiVersion: mirror.openshift.io/v2alpha1\nkind: ImageSetConfiguration\nmirror:\n  additionalImages:\n    - name: quay.io/${id}/tool:v1\n`;
  beforeEach(() => {
    slice = {
      _schema: 1,
      activeProfileId: "p-ready",
      profiles: [
        { id: "p-ready", name: "Ready", updatedAt: 1, content: { platform: false, operators: false, additionalImages: true }, platform: { release: {}, version: {} }, operators: { selected: [] }, additionalImages: [{ id: "img-a", name: "quay.io/p-ready/tool:v1", source: "user" }], paths: {}, readiness: [], warnings: [] },
        { id: "p-empty", name: "Empty", updatedAt: 1, content: { platform: false, operators: true, additionalImages: false }, platform: { release: {}, version: {} }, operators: { catalogMinor: null, selected: [] }, additionalImages: [], paths: {}, readiness: [{ path: "operators.catalogMinor", message: "Select the operator catalog minor (for example 4.22)." }], warnings: [] }
      ]
    };
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      if (path === "/api/mirroring") return Promise.resolve(slice);
      if (path === "/api/mirroring/active") { slice.activeProfileId = JSON.parse(opts.body).profileId; return Promise.resolve(slice); }
      const m = path.match(/^\/api\/mirroring\/profiles\/([^/]+)\/preview$/);
      if (m) {
        if (m[1] === "p-empty") return Promise.reject(Object.assign(new Error("not ready"), { status: 400, payload: { code: "PROFILE_NOT_READY", details: slice.profiles[1].readiness } }));
        return Promise.resolve({ imagesetConfig: yamlFor(m[1]), content: {}, warnings: [] });
      }
      if (path.startsWith("/api/operators/")) return Promise.resolve({});
      return Promise.resolve({});
    });
  });

  it("shows the open profile's file, labelled with the profile, and never another profile's YAML", async () => {
    render(<MirroringShell onExit={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show YAML" }));
    const drawer = await screen.findByRole("region", { name: /YAML/i });
    await waitFor(() => expect(drawer.textContent).toContain("quay.io/p-ready/tool:v1"));
    expect(within(drawer).getByText("Profile: Ready")).toBeTruthy();
    // No reveal toggle and no Install export-policy wording: an ImageSetConfiguration has no secrets.
    expect(within(drawer).queryByText("Show sensitive values")).toBeNull();
    expect(drawer.textContent).not.toContain("Assets & Guide");
    expect(drawer.textContent).toContain("holds no credentials");
    expect(drawer.textContent).not.toMatch(/stable-4\./);

    fireEvent.click(screen.getByRole("button", { name: /^Empty/ }));
    await waitFor(() => expect(drawer.textContent).toContain("not ready to generate its ImageSetConfiguration yet"));
    expect(drawer.textContent).toContain("Draft — not runnable, not downloadable.");
    expect(drawer.textContent).toContain("Select the operator catalog minor");
    expect(drawer.textContent).not.toContain("quay.io/p-ready/tool:v1");
    expect(within(drawer).getByRole("button", { name: "Download" }).disabled).toBe(true);
  });
});
