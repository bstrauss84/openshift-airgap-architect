import { describe, it, expect } from 'vitest';
import {
  computePopoverPlacement,
  POPOVER_VIEWPORT_MARGIN,
  POPOVER_TRIGGER_GAP,
} from '../src/shared/popoverPlacement.js';

const M = POPOVER_VIEWPORT_MARGIN;
const G = POPOVER_TRIGGER_GAP;

const trigger = (top, { left = 400, height = 16 } = {}) => ({
  top,
  bottom: top + height,
  left,
  right: left + height,
});

const place = (overrides = {}) =>
  computePopoverPlacement({
    triggerRect: trigger(500),
    panelWidth: 380,
    panelHeight: 300,
    viewportWidth: 1280,
    viewportHeight: 900,
    preferredMaxHeight: 360,
    ...overrides,
  });

/** The invariant the human QA finding is about. */
function assertFullyInsideViewport(box, viewportHeight, viewportWidth, panelWidth) {
  expect(box.top).toBeGreaterThanOrEqual(M);
  expect(box.top + box.maxHeight).toBeLessThanOrEqual(viewportHeight - M + 0.001);
  expect(box.left).toBeGreaterThanOrEqual(M);
  expect(box.left + panelWidth).toBeLessThanOrEqual(viewportWidth - M + 0.001);
}

describe('computePopoverPlacement', () => {
  describe('enough room above', () => {
    const box = place({ triggerRect: trigger(500), panelHeight: 300 });

    it('uses the preferred side', () => {
      expect(box.placement).toBe('above');
    });

    it('sits gap pixels above the trigger at full natural height', () => {
      expect(box.maxHeight).toBe(300);
      expect(box.top).toBe(500 - G - 300);
    });

    it('is not clamped', () => {
      expect(box.clamped).toBe(false);
    });

    it('stays inside the viewport', () => {
      assertFullyInsideViewport(box, 900, 1280, 380);
    });
  });

  describe('not enough room above, enough below — flips', () => {
    // Trigger high in the viewport: only 100px above, panel wants 300px.
    const box = place({ triggerRect: trigger(100), panelHeight: 300 });

    it('flips below instead of laying out past the top edge', () => {
      expect(box.placement).toBe('below');
    });

    it('starts gap pixels under the trigger', () => {
      expect(box.top).toBe(116 + G);
    });

    it('keeps full natural height', () => {
      expect(box.maxHeight).toBe(300);
    });

    it('never produces a negative top', () => {
      expect(box.top).toBeGreaterThanOrEqual(M);
      assertFullyInsideViewport(box, 900, 1280, 380);
    });
  });

  describe('regression: the reported clipping case', () => {
    // Scrolled page, trigger at y=180, tall help popover. The previous
    // implementation chose "above" for any trigger at y >= 120 and translated
    // the panel up by its own height, producing top = 180 - 16 - 360 = -196.
    const box = place({ triggerRect: trigger(180), panelHeight: 360, preferredMaxHeight: 360 });

    it('does not lay the panel out above the viewport', () => {
      expect(box.top).toBeGreaterThanOrEqual(M);
    });

    it('keeps the whole panel inside the usable viewport', () => {
      assertFullyInsideViewport(box, 900, 1280, 380);
    });

    it('bounds height so the full content remains reachable by scrolling inside', () => {
      expect(box.maxHeight).toBeGreaterThan(0);
      expect(box.maxHeight).toBeLessThanOrEqual(900 - M * 2);
    });
  });

  describe('neither side has full room — anchor to the roomier side, bounded', () => {
    // Short viewport: 320px tall, trigger in the middle. Neither side fits the
    // 600px panel, but below still has a usable 134px.
    const vh = 320;
    const box = place({
      triggerRect: trigger(150),
      panelHeight: 600,
      viewportHeight: vh,
      preferredMaxHeight: 360,
    });

    it('reports that it had to clamp', () => {
      expect(box.clamped).toBe(true);
    });

    it('picks the side with more space', () => {
      expect(box.placement).toBe('below');
    });

    it('clamps into the viewport rather than overflowing either edge', () => {
      assertFullyInsideViewport(box, vh, 1280, 380);
    });

    it('bounds height to the space that side actually has', () => {
      expect(box.maxHeight).toBe(vh - M - (166 + G));
    });
  });

  describe('both sides too cramped — clamp against the whole viewport', () => {
    // 260px viewport with the trigger mid-screen: above has 118px, below 86px.
    // Anchoring to either would be unreadable, so the panel takes the viewport.
    const vh = 260;
    const box = place({
      triggerRect: trigger(138),
      panelHeight: 600,
      viewportHeight: vh,
      preferredMaxHeight: 360,
    });

    it('reports that it had to clamp', () => {
      expect(box.clamped).toBe(true);
    });

    it('starts at the top margin instead of beside the trigger', () => {
      expect(box.top).toBe(M);
    });

    it('bounds height to the usable viewport so content scrolls internally', () => {
      expect(box.maxHeight).toBe(vh - M * 2);
    });

    it('stays fully inside the viewport', () => {
      assertFullyInsideViewport(box, vh, 1280, 380);
    });
  });

  describe('horizontal clamping', () => {
    it('clamps a trigger near the right edge so the panel stays on screen', () => {
      const box = place({ triggerRect: trigger(500, { left: 1260 }) });
      expect(box.left).toBe(1280 - M - 380);
      assertFullyInsideViewport(box, 900, 1280, 380);
    });

    it('clamps a trigger near the left edge to the margin', () => {
      const box = place({ triggerRect: trigger(500, { left: 2 }) });
      expect(box.left).toBe(M);
    });

    it('never returns a left below the margin even on a narrow viewport', () => {
      const box = place({ triggerRect: trigger(500, { left: 10 }), viewportWidth: 300, panelWidth: 380 });
      expect(box.left).toBe(M);
    });
  });

  describe('viewport resize', () => {
    // Trigger high in the viewport, so the panel is placed below and the
    // available height depends directly on viewport height.
    const tall = place({ triggerRect: trigger(100), panelHeight: 300, viewportHeight: 900 });
    const short = place({ triggerRect: trigger(100), panelHeight: 300, viewportHeight: 400 });

    it('fits at full height before the shrink', () => {
      expect(tall.placement).toBe('below');
      expect(tall.maxHeight).toBe(300);
    });

    it('recomputes to a smaller bounded box when the viewport shrinks', () => {
      expect(short.maxHeight).toBeLessThan(tall.maxHeight);
    });

    it('still fits after the shrink', () => {
      assertFullyInsideViewport(short, 400, 1280, 380);
    });
  });

  describe('degenerate input', () => {
    it('survives a missing trigger rect', () => {
      const box = computePopoverPlacement({
        triggerRect: null,
        panelWidth: 380,
        panelHeight: 300,
        viewportWidth: 1280,
        viewportHeight: 900,
      });
      expect(box.top).toBeGreaterThanOrEqual(M);
      expect(box.maxHeight).toBeGreaterThan(0);
    });

    it('never returns a non-positive max height', () => {
      const box = place({ viewportHeight: 10, panelHeight: 600 });
      expect(box.maxHeight).toBeGreaterThan(0);
    });
  });
});
