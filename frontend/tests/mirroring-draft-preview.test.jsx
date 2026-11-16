/**
 * v2.2.0 R-UX09 — a useful DRAFT preview while a profile is not ready:
 * labelled, explained, never downloadable; Download only ever fetches the
 * validated route.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, renderHook, fireEvent } from "@testing-library/react";
import { apiFetch } from "../src/api.js";
import YamlDrawer from "../src/components/YamlDrawer.jsx";
import { useProfilePreview } from "../src/mirroring/useProfilePreview.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(), API_BASE: "" }));

const BLOCKER = { path: "platform.version.locked", message: "Lock the selected OpenShift release before generating platform content." };
const DRAFT_YAML = "# DRAFT — not runnable and not downloadable.\n# Blocker: Lock the selected OpenShift release before generating platform content.\nkind: ImageSetConfiguration\n";

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path.endsWith("/preview")) return Promise.reject(Object.assign(new Error("not ready"), { status: 400, payload: { code: "PROFILE_NOT_READY", details: [BLOCKER] } }));
    if (path.endsWith("/preview-draft")) return Promise.resolve({ draft: true, imagesetConfig: DRAFT_YAML, blockers: [BLOCKER], omitted: [] });
    return Promise.reject(new Error(path));
  });
});
afterEach(cleanup);

describe("draft preview (R-UX09)", () => {
  it("the hook shows the draft when the profile is not ready; Download still asks only the validated route", async () => {
    const { result } = renderHook(() => useProfilePreview({ id: "p-draft0000001", updatedAt: 1 }));
    await waitFor(() => expect(result.current.draft?.yaml).toBe(DRAFT_YAML));
    expect(result.current.yaml).toBe("");
    expect(result.current.notReady).toEqual([BLOCKER.message]);
    await expect(result.current.fetchForDownload()).rejects.toThrow("not ready");
    const downloadCalls = vi.mocked(apiFetch).mock.calls.filter(([p]) => p.endsWith("/preview-draft"));
    expect(downloadCalls).toHaveLength(1); // only the preview's own draft request, never a download
  });

  it("the drawer labels the draft, shows why, and disables Download", () => {
    const fetchExportFile = vi.fn();
    render(<YamlDrawer isOpen onClose={() => {}} mode="imageset" sourceLabel="Profile: P" previewFiles={{ "imageset-config.yaml": DRAFT_YAML }} fetchExportFile={fetchExportFile}
      draftNotice={<><strong>Draft — not runnable, not downloadable.</strong> <button type="button">Go to release lock</button></>} />);
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    expect(screen.getByText("Draft — not runnable, not downloadable.")).toBeInTheDocument();
    const download = screen.getByRole("button", { name: "Download" });
    expect(download).toBeDisabled();
    fireEvent.click(download);
    expect(fetchExportFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Go to release lock" })).toBeInTheDocument();
  });

  it("a ready profile's preview is unchanged: no DRAFT badge, Download enabled", () => {
    render(<YamlDrawer isOpen onClose={() => {}} mode="imageset" sourceLabel="Profile: P" previewFiles={{ "imageset-config.yaml": "kind: ImageSetConfiguration\n" }} fetchExportFile={vi.fn()} />);
    expect(screen.queryByText("DRAFT")).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });
});
