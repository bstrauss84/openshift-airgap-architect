/**
 * OpenShift Airgap Architect - Test Suite
 *
 * B / R4 presentation: the failure-domain "Server" field must use the SAME
 * canonical validation presentation as Topology: Compute cluster and
 * Topology: Datastore.
 *
 * Root cause this guards against: Server's <FieldLabelWithInfo> and its
 * .field-control-support sibling were NOT wrapped in .field-control-stack,
 * unlike computeCluster/datastore. Two consequences:
 *   1. The red error color comes from
 *      `.platform-specifics .field-control-stack .field-error`, so an unwrapped
 *      error rendered with default (plain/white) styling.
 *   2. .field-control-stack is the `grid-row: span 3 / subgrid` cell. Unwrapped,
 *      the support div became its own grid item, so the error landed in the
 *      NEXT field's cell and pushed that field out of alignment.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isValidVsphereHost } from "../src/validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stepSrc = fs.readFileSync(
  path.join(__dirname, "../src/steps/PlatformSpecificsStep.jsx"),
  "utf8"
);
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

/**
 * Slice the JSX for one failure-domain field, from its label to the end of the
 * .field-control-support block that carries its error.
 */
function fieldRegion(labelText, errorKeySuffix) {
  const labelIdx = stepSrc.indexOf(`label="${labelText}"`);
  expect(labelIdx, `label ${labelText} not found`).toBeGreaterThan(-1);
  const errIdx = stepSrc.indexOf(`_${errorKeySuffix}") && <span`, labelIdx);
  expect(errIdx, `error span for ${errorKeySuffix} not found`).toBeGreaterThan(-1);
  const close = stepSrc.indexOf("</div>", errIdx);
  return { labelIdx, errIdx, text: stepSrc.slice(labelIdx, close) };
}

/** Nearest preceding opening tag of `cls` before `idx`, if it is not yet closed. */
function wrappedIn(cls, labelIdx) {
  const openIdx = stepSrc.lastIndexOf(`<div className="${cls}">`, labelIdx);
  if (openIdx === -1) return false;
  // Anything between the wrapper and the label must not itself be a sibling
  // FieldLabelWithInfo (which would mean the wrapper belongs to a prior field).
  const between = stepSrc.slice(openIdx, labelIdx);
  return !between.includes("</FieldLabelWithInfo>");
}

describe("B: Server uses the canonical Compute cluster / Datastore error pattern", () => {
  it("Compute cluster is wrapped in .field-control-stack (reference pattern)", () => {
    const { labelIdx } = fieldRegion("Topology: Compute cluster", "computeCluster");
    expect(wrappedIn("field-control-stack", labelIdx)).toBe(true);
  });

  it("Datastore is wrapped in .field-control-stack (reference pattern)", () => {
    const { labelIdx } = fieldRegion("Topology: Datastore", "datastore");
    expect(wrappedIn("field-control-stack", labelIdx)).toBe(true);
  });

  it("Server is wrapped in .field-control-stack, like its peers", () => {
    const { labelIdx } = fieldRegion("Server (vCenter hostname, FQDN, or IP)", "server");
    expect(wrappedIn("field-control-stack", labelIdx)).toBe(true);
  });

  it("Server's error lives in its own .field-control-support inside that wrapper", () => {
    const { text } = fieldRegion("Server (vCenter hostname, FQDN, or IP)", "server");
    expect(text).toContain('className="field-control-support"');
    expect(text).toContain('className="field-error"');
    // The error must be emitted before the next field begins.
    expect(text).not.toContain('label="Topology: Datacenter"');
  });

  it("Server uses the same error class and input-error treatment as peers", () => {
    const server = fieldRegion("Server (vCenter hostname, FQDN, or IP)", "server").text;
    const compute = fieldRegion("Topology: Compute cluster", "computeCluster").text;
    for (const marker of ['className="field-error"', "input-error", "aria-invalid", "aria-describedby"]) {
      expect(server, `Server missing ${marker}`).toContain(marker);
      expect(compute, `Compute cluster missing ${marker}`).toContain(marker);
    }
  });

  it("the red error color is only delivered via the .field-control-stack rule", () => {
    // Documents WHY the wrapper is required: without it there is no error color.
    expect(css).toContain(".platform-specifics .field-control-stack .field-error");
    const idx = css.indexOf(".platform-specifics .field-control-stack .field-error");
    const body = css.slice(css.indexOf("{", idx), css.indexOf("}", idx));
    expect(body).toMatch(/color:\s*var\(--error-color/);
  });

  it("the wrapper is the subgrid cell that keeps the next field aligned", () => {
    const idx = css.indexOf("> .field-control-stack {");
    expect(idx).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf("{", idx), css.indexOf("}", idx));
    expect(body).toMatch(/grid-row:\s*span 3/);
    expect(body).toMatch(/grid-template-rows:\s*subgrid/);
  });

  it("the Server label advertises hostname, FQDN, or IP — matching the validator", () => {
    expect(stepSrc).toContain('label="Server (vCenter hostname, FQDN, or IP)"');
    expect(stepSrc).not.toContain('label="Server (vCenter FQDN or IP)"');
  });
});

describe("B1: Server validation keeps upstream installer semantics", () => {
  it("accepts a single-label hostname (installer validate.Host allows it)", () => {
    expect(isValidVsphereHost("vcenter")).toBe(true);
  });

  it("accepts an FQDN", () => {
    expect(isValidVsphereHost("vcenter.example.com")).toBe(true);
  });

  it("accepts an IPv4 address", () => {
    expect(isValidVsphereHost("192.168.1.10")).toBe(true);
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "   ", "VCENTER.EXAMPLE.COM", "has space", "-leading.example.com"]) {
      expect(isValidVsphereHost(bad), `${JSON.stringify(bad)} should be rejected`).toBe(false);
    }
  });

  it("does not promise a stricter contract than it enforces", () => {
    const vsrc = fs.readFileSync(path.join(__dirname, "../src/validation.js"), "utf8");
    expect(vsrc).not.toContain("Must be a domain name or IP address");
    expect(vsrc).toContain("hostname, FQDN, or IP");
  });
});
