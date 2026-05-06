/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../src/App.jsx";
import { apiFetch } from "../src/api.js";
import { stateWithBlueprintCompleteMethodologyIncomplete } from "./fixtures/minimalState.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

/**
 * Parse rgb/rgba string to [r,g,b] in 0-1 range.
 */
function parseRgb(str) {
  if (!str || str === "transparent") return null;
  const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
  const hex = str.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  return null;
}

/**
 * Relative luminance (WCAG 2.1) for sRGB.
 */
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio (1 to 21) between two colors.
 */
function contrastRatio(color1, color2) {
  const l1 = luminance(color1);
  const l2 = luminance(color2);
  const L = Math.max(l1, l2) + 0.05;
  const S = Math.min(l1, l2) + 0.05;
  return L / S;
}

/**
 * Get effective background color (first opaque when walking up from element).
 */
function getEffectiveBackground(el) {
  let node = el;
  while (node && node !== document.body) {
    const bg = parseRgb(getComputedStyle(node).backgroundColor);
    if (bg) {
      const a = getComputedStyle(node).opacity;
      const alpha = node === el ? 1 : parseFloat(a);
      if (alpha >= 0.99) return bg;
    }
    node = node.parentElement;
  }
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  return parseRgb(bodyBg);
}

/**
 * Assert minimum contrast between element's text color and its effective background.
 */
function assertReadable(el, minRatio = 3) {
  const style = getComputedStyle(el);
  const textColor = parseRgb(style.color);
  const bg = getEffectiveBackground(el);
  if (!textColor || !bg) return { ok: true, ratio: null, skip: true };
  const ratio = contrastRatio(textColor, bg);
  return { ok: ratio >= minRatio, ratio, skip: false };
}

const MIN_CONTRAST = 3;

describe("Theme readability (light vs dark)", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/state") {
        return Promise.resolve(opts?.body ? JSON.parse(opts.body) : stateWithBlueprintCompleteMethodologyIncomplete());
      }
      return Promise.resolve({});
    });
  });

  it("keeps text readable against background in light mode", async () => {
    document.body.dataset.theme = "light";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });

    const selectors = ["body", ".landing-title", ".landing-subtitle", ".landing-card-install"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const result = assertReadable(el, MIN_CONTRAST);
      if (result.skip) continue;
      expect(result.ratio, `${sel} in light mode should have contrast >= ${MIN_CONTRAST}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("keeps text readable against background in dark mode", async () => {
    document.body.dataset.theme = "dark";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Continue install/i })).toBeInTheDocument();
    });

    const selectors = ["body", ".landing-title", ".landing-subtitle", ".landing-card-install"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const result = assertReadable(el, MIN_CONTRAST);
      if (result.skip) continue;
      expect(result.ratio, `${sel} in dark mode should have contrast >= ${MIN_CONTRAST}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });
});
