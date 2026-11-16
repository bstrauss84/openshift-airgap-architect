/**
 * v2.2.0 M4 — import UI: the dialog shows each file's status in words (never
 * colour alone), blocks Import while a file is invalid or a conflict is open,
 * and sends raw bytes; the workspace card shows provenance, the original and
 * an explicit "leave out" review; the profile status separates "needs review"
 * from "awaiting live catalog verification".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import ImportDialog, { fileStatus } from "../src/mirroring/ImportDialog.jsx";
import ImportedFilesCard from "../src/mirroring/ImportedFilesCard.jsx";
import { profileStatus } from "../src/mirroring/ProfileWorkspace.jsx";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));
afterEach(cleanup);

const validFile = (index, name, extra = {}) => ({
  index, fileName: name, bytes: 120, sha256: "a".repeat(64), status: "valid", stage: "valid", errors: [], warnings: [],
  representable: true, unresolved: [], alreadyImportedInto: [],
  summary: { content: { platform: true, operators: true, additionalImages: false }, platformRelease: "4.22.18", catalogMinor: "4.22", operators: 2, operatorsWithoutChannel: 1, images: 0, archiveSize: null, catalogPlatformMismatch: null },
  ...extra
});
const invalidFile = (index, name) => ({
  index, fileName: name, bytes: 40, sha256: "b".repeat(64), status: "invalid", stage: "parse",
  errors: [{ code: "INVALID_YAML", message: "The file is not valid YAML: unexpected end.", line: 3 }], warnings: []
});

let calls;
beforeEach(() => {
  calls = [];
  vi.mocked(apiFetch).mockReset();
});

const choose = (input, files) => fireEvent.change(input, { target: { files } });

describe("import dialog", () => {
  it("sends raw bytes, explains an invalid file with its line, and blocks Import until it is removed", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      const body = JSON.parse(opts.body);
      calls.push([path, body]);
      if (path.endsWith("/analyze")) {
        const files = body.files.map((f, i) => (f.name === "bad.yaml" ? invalidFile(i, f.name) : validFile(i, f.name)));
        const invalid = files.some((f) => f.status === "invalid");
        return Promise.resolve({ mode: body.mode, files, conflicts: [], blocking: invalid ? ["Remove the files that are not valid ImageSetConfigurations; they are never imported."] : [], applicable: !invalid });
      }
      return Promise.resolve({ profiles: [], activeProfileId: null, imported: ["p-new"] });
    });
    const onImported = vi.fn();
    render(<ImportDialog isOpen onClose={() => {}} onImported={onImported} />);
    const input = screen.getByLabelText(/Files to import/);
    const good = new File(["apiVersion: mirror.openshift.io/v2alpha1\n"], "good.yaml", { type: "application/yaml" });
    const bad = new File([new Uint8Array([0x6b, 0x3a, 0xff])], "bad.yaml");
    choose(input, [good, bad]);
    await screen.findByText("good.yaml");
    const sent = calls.find(([p]) => p.endsWith("/analyze"))[1].files;
    expect(atob(sent[1].contentBase64).charCodeAt(2)).toBe(0xff); // raw bytes, not a text decoding
    expect(screen.getByText(/Line 3: The file is not valid YAML/)).toBeTruthy();
    expect(screen.getByText("Not a valid ImageSetConfiguration")).toBeTruthy();
    expect(screen.getByText(/operator catalogs not checked yet/)).toBeTruthy();
    expect(screen.getByText(/1 without a channel: resolved from the scanned catalogs later/)).toBeTruthy();
    const importBtn = screen.getByRole("button", { name: "Import" });
    expect(importBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove bad.yaml from the import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    const applied = calls.find(([p]) => p.endsWith("/apply"))[1];
    expect(applied.files.map((f) => f.name)).toEqual(["good.yaml"]);
    expect(applied.mode).toBe("separate");
  });

  it("merge: every conflict needs a choice before Import is enabled", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      const body = JSON.parse(opts.body);
      calls.push([path, body]);
      if (path.endsWith("/analyze")) {
        const conflicts = body.mode === "merge" ? [{ id: "platform", kind: "platform", message: "The sources mirror different OpenShift platform releases.", options: [{ id: "0", label: "a.yaml: release 4.22.18" }, { id: "1", label: "b.yaml: release 4.21.9" }] }] : [];
        return Promise.resolve({ mode: body.mode, files: [validFile(0, "a.yaml"), validFile(1, "b.yaml")], conflicts, blocking: [], applicable: conflicts.length === 0 });
      }
      return Promise.resolve({ profiles: [], imported: ["p-m"] });
    });
    render(<ImportDialog isOpen onClose={() => {}} onImported={() => {}} />);
    choose(screen.getByLabelText(/Files to import/), [new File(["a"], "a.yaml"), new File(["b"], "b.yaml")]);
    fireEvent.click(await screen.findByRole("radio", { name: "Merge into one new profile" }));
    const group = await screen.findByRole("group", { name: /different OpenShift platform releases/ });
    expect(screen.getByRole("button", { name: "Import" }).disabled).toBe(true);
    fireEvent.click(within(group).getByRole("radio", { name: /b\.yaml: release 4\.21\.9/ }));
    expect(screen.getByRole("button", { name: "Import" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(calls.some(([p]) => p.endsWith("/apply"))).toBe(true));
    expect(calls.find(([p]) => p.endsWith("/apply"))[1]).toMatchObject({ mode: "merge", resolutions: { platform: "1" } });
  });

  it("file status is words plus an icon, never colour alone", () => {
    expect(fileStatus(invalidFile(0, "x")).label).toBe("Not a valid ImageSetConfiguration");
    expect(fileStatus(validFile(0, "x", { unresolved: [{ id: "u" }] })).label).toMatch(/needs review/);
    expect(fileStatus(validFile(0, "x", { summary: { ...validFile(0, "x").summary, operators: 0 } })).label).toBe("Valid structure");
  });

  it("refuses an oversized file before reading it", async () => {
    render(<ImportDialog isOpen onClose={() => {}} onImported={() => {}} />);
    const big = new File(["x"], "big.yaml");
    Object.defineProperty(big, "size", { value: 2 * 1024 * 1024 });
    choose(screen.getByLabelText(/Files to import/), [big]);
    expect((await screen.findByRole("alert")).textContent).toMatch(/larger than 1 MiB/);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("imported files in the workspace", () => {
  const profile = (status = "open") => ({
    id: "p-imp", name: "imp", readiness: [], content: { platform: false, operators: false, additionalImages: true },
    imports: [{ id: "imp-0123456789ab", fileName: "site.yaml", sha256: "c".repeat(64), bytes: 300, importedAt: 1793000000000, mode: "separate",
      unresolved: [{ id: "u-1", path: "mirror.helm", code: "UNREPRESENTABLE", message: "Helm charts (mirror.helm) are kept in the original file but cannot be edited or generated here yet.", status }], warnings: [] }]
  });

  it("shows provenance, the original (verified) and an explicit Leave out", async () => {
    vi.mocked(apiFetch).mockImplementation((path, opts = {}) => {
      calls.push([path, opts.body ? JSON.parse(opts.body) : null]);
      if (path.endsWith("/review")) return Promise.resolve(profile("omitted"));
      return Promise.resolve({ id: "imp-0123456789ab", fileName: "site.yaml", sha256: "c".repeat(64), bytes: 300, content: "kind: ImageSetConfiguration\nmirror:\n  helm: {}\n" });
    });
    const onChanged = vi.fn();
    render(<ImportedFilesCard profile={profile()} onProfileChanged={onChanged} />);
    expect(screen.getByText("c".repeat(64))).toBeTruthy();
    expect(screen.getByText(/Needs review: 1 part/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Leave out of this profile: mirror.helm" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find(([p]) => p.endsWith("/review"))[1]).toEqual({ action: "omit", itemIds: ["u-1"] });
    fireEvent.click(screen.getByRole("button", { name: "View the original site.yaml" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByLabelText("Contents of site.yaml").textContent).toContain("helm: {}");
  });

  it("omitted items say they are still in the original", () => {
    render(<ImportedFilesCard profile={profile("omitted")} onProfileChanged={() => {}} />);
    expect(screen.getByText(/Left out \(still in the original\):/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Leave out of this profile/ })).toBeNull();
  });
});

describe("profile status", () => {
  const base = { content: { platform: false, operators: true, additionalImages: false }, operators: { catalogMinor: "4.22", selected: [] }, readiness: [] };
  it("needs review > not ready > awaiting verification > ready", () => {
    expect(profileStatus({ ...base, readiness: [{ code: "IMPORT_REVIEW_REQUIRED" }] }).key).toBe("review");
    expect(profileStatus({ ...base, readiness: [{ code: "CATALOG_PLATFORM_MINOR_CONFLICT" }] }).key).toBe("review");
    expect(profileStatus({ ...base, readiness: [{ path: "x" }] }).key).toBe("not-ready");
    const op = { name: "w", catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.22", defaultChannel: "fast" };
    const pending = profileStatus({ ...base, operators: { catalogMinor: "4.22", selected: [op] } });
    expect(pending.key).toBe("awaiting-verification");
    expect(pending.detail).toMatch(/without internet access/);
    expect(profileStatus({ ...base, operators: { catalogMinor: "4.22", selected: [{ ...op, verifiedMinor: "4.22" }] } }).key).toBe("ready");
  });
});
