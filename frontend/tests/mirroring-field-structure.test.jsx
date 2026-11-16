/**
 * v2.2.0 M2 — Mirroring screens obey the same field contract as Install.
 *
 * The data-driven Install guard (field-support-structure.test.jsx) only renders
 * PlatformSpecificsStep, so it cannot see a Mirroring field. This suite renders
 * every Mirroring form with ALL validation messages forced visible and runs the
 * SAME checkers (tests/helpers/fieldSupportStructure.js), plus the R4 band
 * order, the fragment scan over Mirroring source, the hint template-literal
 * syntax rule and a help-quality floor for every Mirroring and release hint.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  findSupportPlacementViolations,
  findFragmentWrappedSupport,
  findBandOrderViolations
} from "./helpers/fieldSupportStructure.js";
import ContentSelection from "../src/mirroring/ContentSelection.jsx";
import AdditionalImagesEditor from "../src/mirroring/AdditionalImagesEditor.jsx";
import OperatorsSection from "../src/mirroring/OperatorsSection.jsx";
import {
  PROFILE_NAME_HINT, CONTENT_TYPES_HINT, CATALOG_MINOR_HINT, OPERATOR_SCAN_PULL_SECRET_HINT, ADDITIONAL_IMAGE_HINT,
  IMPORT_FILES_HINT, IMPORT_MODE_HINT,
  ARCHIVE_SIZE_HINT, RETRY_TIMES_HINT, RETRY_DELAY_HINT, IMAGE_TIMEOUT_HINT, LOG_LEVEL_HINT, SINCE_HINT,
  RUN_PULL_SECRET_HINT, CATALOG_CHECK_HINT,
  WORKFLOW_HINT, REGISTRY_URL_HINT, MIRROR_SECRET_HINT, TRANSFER_DIR_HINT, BULK_IMAGES_HINT, OPERATIONS_HINT, STORAGE_HINT
} from "../src/mirroring/mirroringCopy.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn(() => new Promise(() => {})), API_BASE: "" }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../src");
const MIRRORING_SOURCES = [
  "mirroring/ContentSelection.jsx",
  "mirroring/MirroringShell.jsx",
  "mirroring/ProfileWorkspace.jsx",
  "mirroring/PlatformReleaseSection.jsx",
  "mirroring/OperatorsSection.jsx",
  "mirroring/AdditionalImagesEditor.jsx",
  "components/ReleaseSelector.jsx",
  "components/operators/OperatorCatalogBrowser.jsx",
  "components/operators/SelectedOperatorCard.jsx",
  "components/operators/OperatorVersionConstraints.jsx",
  "mirroring/ImportDialog.jsx",
  "mirroring/ImportedFilesCard.jsx",
  "mirroring/MirroringRunPanel.jsx",
  "components/OcMirrorParallelismFields.jsx",
  "components/PreflightChecklist.jsx",
  "mirroring/HighSideControls.jsx",
  "mirroring/BulkImagesDialog.jsx",
  "mirroring/MirroringOperations.jsx",
  "components/RegistryCredentialHelper.jsx",
  "components/ServerFolderBrowser.jsx"
];
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const emptyProfile = {
  id: "p-test00000001",
  name: "",
  content: { platform: false, operators: false, additionalImages: false },
  platform: { release: {}, version: {} },
  paths: {}
};

afterEach(cleanup);

describe("Mirroring fields keep supporting content inside their own wrapper", () => {
  it("content selection with every error visible: no placement or band-order violation", () => {
    const { container } = render(
      <div className="step">
        <ContentSelection profile={emptyProfile} saving={false} onSubmit={() => {}} forceShowErrors />
      </div>
    );
    // Non-vacuous: the errors this sweep is about really are on screen.
    expect(container.querySelectorAll(".field-error").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("#error-mirroring-profile-name")).not.toBeNull();
    expect(findSupportPlacementViolations(container)).toEqual([]);
    expect(findBandOrderViolations(container)).toEqual([]);
  });

  it("the name error sits in its own support band, above the helper text (R1, R4)", () => {
    const { container } = render(
      <ContentSelection profile={emptyProfile} saving={false} onSubmit={() => {}} forceShowErrors />
    );
    const error = container.querySelector("#error-mirroring-profile-name");
    const support = error.parentElement;
    expect(support.classList.contains("field-control-support")).toBe(true);
    expect(support.parentElement.classList.contains("field-control-stack")).toBe(true);
    expect(support.firstElementChild).toBe(error);
    const input = container.querySelector("#mirroring-profile-name");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("error-mirroring-profile-name");
  });

  it("additional image rows with errors visible: no placement or band-order violation", () => {
    const profile = { id: "p-s", name: "s", content: { additionalImages: true }, additionalImages: [
      { id: "img-bad00001", name: "quay.io/org/app", source: "user" },
      { id: "img-sug00001", name: "quay.io/v/disk:9", source: "operator:x" }
    ] };
    const { container } = render(<div className="step"><AdditionalImagesEditor profile={profile} onProfileChanged={() => {}} /></div>);
    for (const input of container.querySelectorAll("input")) fireEvent.blur(input);
    expect(container.querySelectorAll(".field-error").length).toBeGreaterThanOrEqual(1);
    expect(findSupportPlacementViolations(container)).toEqual([]);
    expect(findBandOrderViolations(container)).toEqual([]);
  });

  it("operators section: the catalog minor field keeps its helper inside its own support band", () => {
    const profile = { id: "p-o", name: "o", updatedAt: 1, content: { operators: true, platform: false }, platform: { release: {}, version: {} }, operators: { catalogMinor: null, catalogMinorSource: null, selected: [] }, additionalImages: [] };
    const { container } = render(<div className="step"><OperatorsSection profile={profile} onProfileChanged={() => {}} /></div>);
    const helper = container.querySelector(`#mirroring-catalog-minor-help-p-o`);
    expect(helper.parentElement.classList.contains("field-control-support")).toBe(true);
    expect(findSupportPlacementViolations(container)).toEqual([]);
  });

  it("import dialog with a read error visible: no placement or band-order violation", async () => {
    const { default: ImportDialog } = await import("../src/mirroring/ImportDialog.jsx");
    render(<ImportDialog isOpen onClose={() => {}} onImported={() => {}} />);
    const input = document.querySelector("#mirroring-import-files");
    const big = new File(["x"], "big.yaml");
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    const dialog = document.querySelector(".mirroring-import-modal");
    expect(dialog.querySelector(".field-error")).not.toBeNull();
    expect(findSupportPlacementViolations(dialog)).toEqual([]);
    expect(findBandOrderViolations(dialog)).toEqual([]);
  });

  it.each(MIRRORING_SOURCES)("%s: no fragment-wrapped support content", (rel) => {
    expect(findFragmentWrappedSupport(read(rel))).toEqual([]);
  });
});

describe("help content meets the repository standard", () => {
  it.each(MIRRORING_SOURCES)("%s: hints use template-literal or constant syntax, never hint=\"…\"", (rel) => {
    expect(read(rel)).not.toMatch(/hint="/);
  });

  const releaseSrc = read("components/ReleaseSelector.jsx");
  const releaseHints = [...releaseSrc.matchAll(/const ([A-Z_]+_HINT) = `([\s\S]*?)`;/g)].map((m) => [m[1], m[2]]);
  const browserSrc = read("components/operators/OperatorCatalogBrowser.jsx");
  const searchHint = browserSrc.match(/const SEARCH_HINT = `([\s\S]*?)`;/)[1];
  // M5: the shared parallelism fields keep their hints in a FIELDS table.
  const parallelSrc = read("components/OcMirrorParallelismFields.jsx");
  const parallelHints = [...parallelSrc.matchAll(/key: "(\w+)",\s*label: "[^"]+",\s*hint: `([\s\S]*?)`/g)].map((m) => [`${m[1]} hint`, m[2]]);
  it("finds both parallelism hints (guards against a vacuous pass)", () => {
    expect(parallelHints.map(([n]) => n)).toEqual(["parallelImages hint", "parallelLayers hint"]);
  });
  const allHints = [
    ["ARCHIVE_SIZE_HINT", ARCHIVE_SIZE_HINT], ["RETRY_TIMES_HINT", RETRY_TIMES_HINT], ["RETRY_DELAY_HINT", RETRY_DELAY_HINT],
    ["IMAGE_TIMEOUT_HINT", IMAGE_TIMEOUT_HINT], ["LOG_LEVEL_HINT", LOG_LEVEL_HINT], ["SINCE_HINT", SINCE_HINT],
    ["RUN_PULL_SECRET_HINT", RUN_PULL_SECRET_HINT], ["CATALOG_CHECK_HINT", CATALOG_CHECK_HINT], ...parallelHints,
    ["WORKFLOW_HINT", WORKFLOW_HINT], ["REGISTRY_URL_HINT", REGISTRY_URL_HINT], ["MIRROR_SECRET_HINT", MIRROR_SECRET_HINT], ["TRANSFER_DIR_HINT", TRANSFER_DIR_HINT], ["BULK_IMAGES_HINT", BULK_IMAGES_HINT], ["OPERATIONS_HINT", OPERATIONS_HINT], ["STORAGE_HINT", STORAGE_HINT],
    ["PROFILE_NAME_HINT", PROFILE_NAME_HINT], ["CONTENT_TYPES_HINT", CONTENT_TYPES_HINT],
    ["CATALOG_MINOR_HINT", CATALOG_MINOR_HINT], ["OPERATOR_SCAN_PULL_SECRET_HINT", OPERATOR_SCAN_PULL_SECRET_HINT],
    ["ADDITIONAL_IMAGE_HINT", ADDITIONAL_IMAGE_HINT], ["SEARCH_HINT", searchHint],
    ["IMPORT_FILES_HINT", IMPORT_FILES_HINT], ["IMPORT_MODE_HINT", IMPORT_MODE_HINT], ...releaseHints
  ];

  it("finds the release selector's hints (guards against a vacuous pass)", () => {
    expect(releaseHints.map(([n]) => n).sort()).toEqual(
      ["MANUAL_MINOR_HINT", "MANUAL_PATCH_HINT", "MINOR_CHANNEL_HINT", "PATCH_VERSION_HINT"]
    );
  });

  it.each(allHints)("%s is substantive: sections, an example or caveat, more than a sentence", (_name, hint) => {
    expect(hint.length).toBeGreaterThan(250);
    expect(hint).toMatch(/\*\*[^*]+:\*\*/); // at least one bold section heading
    expect(hint).toMatch(/example|e\.g\.|⚠️/i);
    expect(hint.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });

  it("the content-type help explains low side vs high side and how content crosses the air gap", () => {
    expect(CONTENT_TYPES_HINT).toMatch(/low\) side/);
    expect(CONTENT_TYPES_HINT).toMatch(/high\) side/);
    expect(CONTENT_TYPES_HINT).toMatch(/prepare a transfer/);
    expect(CONTENT_TYPES_HINT).toMatch(/disk to mirror/);
  });
});
