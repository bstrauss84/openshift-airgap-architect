/**
 * OpenShift Airgap Architect - Popover / Tooltip Viewport Placement
 *
 * Pure placement math for viewport-collision-aware help panels.
 *
 * Contract (see docs/DESIGN_SYSTEM.md "Help and info popovers"):
 *   1. The panel is never laid out past the usable viewport boundary.
 *   2. Preferred side is used when the panel fits there; otherwise it flips.
 *   3. When neither side fits, the panel is clamped into the viewport and its
 *      height is bounded so the content scrolls *inside* the panel.
 *   4. Horizontal position is clamped to a viewport margin on both edges.
 *
 * No DOM access: callers pass measured geometry so the math stays unit-testable.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/** Minimum gap kept between the panel and the usable viewport edge. */
export const POPOVER_VIEWPORT_MARGIN = 12;

/** Gap between the trigger and the panel. */
export const POPOVER_TRIGGER_GAP = 8;

/**
 * Below this, a side is considered too cramped to be worth flipping to; the
 * panel is clamped against the full usable viewport instead.
 */
export const POPOVER_MIN_USABLE_SIDE_HEIGHT = 120;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Compute a viewport-clamped position and height bound for a help panel.
 *
 * @param {Object} input
 * @param {{top:number,bottom:number,left:number,right:number}} input.triggerRect
 *   Trigger bounding rect in viewport (client) coordinates.
 * @param {number} input.panelWidth   Measured panel width.
 * @param {number} input.panelHeight  Measured *natural* (unconstrained) panel height.
 * @param {number} input.viewportWidth
 * @param {number} input.viewportHeight
 * @param {number} [input.gap]        Trigger-to-panel gap.
 * @param {number} [input.margin]     Viewport edge margin.
 * @param {number} [input.preferredMaxHeight] Design cap on panel height.
 * @param {boolean} [input.preferAbove] Preferred side when both fit.
 * @returns {{placement:'above'|'below', top:number, left:number, maxHeight:number, clamped:boolean}}
 *   `top`/`left` are viewport (position: fixed) coordinates. `maxHeight` must be
 *   applied to the panel so overflow scrolls internally. `clamped` is true when
 *   neither side could hold the panel at its desired height.
 */
export function computePopoverPlacement({
  triggerRect,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  gap = POPOVER_TRIGGER_GAP,
  margin = POPOVER_VIEWPORT_MARGIN,
  preferredMaxHeight = Number.POSITIVE_INFINITY,
  preferAbove = true,
}) {
  const vw = Math.max(0, Number(viewportWidth) || 0);
  const vh = Math.max(0, Number(viewportHeight) || 0);
  const rect = triggerRect || { top: 0, bottom: 0, left: 0, right: 0 };

  // Total height available to a panel that ignores the trigger entirely.
  const usableHeight = Math.max(1, vh - margin * 2);

  const desiredHeight = Math.max(1, Math.min(panelHeight || 0, preferredMaxHeight, usableHeight));

  const spaceAbove = Math.max(0, rect.top - gap - margin);
  const spaceBelow = Math.max(0, vh - margin - (rect.bottom + gap));

  const fitsAbove = desiredHeight <= spaceAbove;
  const fitsBelow = desiredHeight <= spaceBelow;

  let placement;
  if (preferAbove && fitsAbove) placement = 'above';
  else if (fitsBelow) placement = 'below';
  else if (fitsAbove) placement = 'above';
  else placement = spaceBelow >= spaceAbove ? 'below' : 'above';

  const sideSpace = placement === 'above' ? spaceAbove : spaceBelow;
  const sideIsUsable = sideSpace >= Math.min(desiredHeight, POPOVER_MIN_USABLE_SIDE_HEIGHT);

  let maxHeight;
  let top;
  const clamped = !(fitsAbove || fitsBelow);

  if (sideIsUsable) {
    maxHeight = Math.max(1, Math.min(desiredHeight, sideSpace));
    top = placement === 'above' ? rect.top - gap - maxHeight : rect.bottom + gap;
  } else {
    // Neither side can hold a readable panel: clamp against the whole viewport
    // and let the content scroll inside.
    maxHeight = Math.max(1, Math.min(desiredHeight, usableHeight));
    top = margin;
  }

  top = clamp(top, margin, vh - margin - maxHeight);

  const width = Math.max(0, panelWidth || 0);
  const left = clamp(rect.left, margin, vw - margin - width);

  return { placement, top, left, maxHeight, clamped };
}
