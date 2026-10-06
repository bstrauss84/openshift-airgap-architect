/**
 * @vitest-environment jsdom
 *
 * Behaviour-level cover for the shared info/help popover: the rendered panel
 * must never be laid out past the usable viewport, at any trigger position.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import FieldLabelWithInfo from '../src/components/FieldLabelWithInfo.jsx';
import { POPOVER_VIEWPORT_MARGIN } from '../src/shared/popoverPlacement.js';

// Long enough to take the click-popover branch (> 180 chars).
const LONG_HINT = 'Confidential compute policy for '.repeat(12);

const PANEL_HEIGHT = 360;
const PANEL_WIDTH = 380;

let triggerTop = 500;
const VIEWPORT_HEIGHT = 900;
const VIEWPORT_WIDTH = 1280;

let originalRect;
let originalOffsetHeight;
let originalOffsetWidth;

/**
 * jsdom has no layout. Stub just enough geometry for the component's
 * measure-then-place pass: a trigger rect and a natural panel size.
 */
function installLayoutStubs() {
  originalRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList?.contains('field-info-icon')) {
      return {
        top: triggerTop,
        bottom: triggerTop + 16,
        left: 400,
        right: 416,
        width: 16,
        height: 16,
      };
    }
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  };

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.classList?.contains('field-tooltip-portal') ? PANEL_HEIGHT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.classList?.contains('field-tooltip-portal') ? PANEL_WIDTH : 0;
    },
  });
}

function restoreLayoutStubs() {
  if (originalRect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', originalRect);
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
}

beforeEach(() => {
  window.innerHeight = VIEWPORT_HEIGHT;
  window.innerWidth = VIEWPORT_WIDTH;
  installLayoutStubs();
});

afterEach(() => {
  restoreLayoutStubs();
  cleanup();
});

function openPopoverWithTriggerAt(top) {
  triggerTop = top;
  render(<FieldLabelWithInfo label="Confidential compute (optional)" hint={LONG_HINT} />);
  fireEvent.click(screen.getByRole('button', { name: /open help/i }));
  return screen.getByRole('dialog', { name: 'Help' });
}

const px = (value) => Number.parseFloat(String(value).replace('px', ''));

describe('Field help popover viewport containment', () => {
  it('opens below the trigger when there is not enough room above', () => {
    const panel = openPopoverWithTriggerAt(180);
    expect(panel.dataset.placement).toBe('below');
  });

  it('never lays the panel out above the top of the viewport', () => {
    // Reported failure: page scrolled so the trigger sits high; the old code
    // placed the panel "above" and translated it up by its own height.
    const panel = openPopoverWithTriggerAt(180);
    expect(px(panel.style.top)).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it('keeps the panel bottom inside the viewport', () => {
    const panel = openPopoverWithTriggerAt(180);
    expect(px(panel.style.top) + px(panel.style.maxHeight)).toBeLessThanOrEqual(
      VIEWPORT_HEIGHT - POPOVER_VIEWPORT_MARGIN
    );
  });

  it('applies a max-height so overflowing content scrolls inside the panel', () => {
    const panel = openPopoverWithTriggerAt(180);
    expect(px(panel.style.maxHeight)).toBeGreaterThan(0);
    expect(panel.style.overflow).not.toBe('visible');
  });

  it('places above when there is ample room above', () => {
    const panel = openPopoverWithTriggerAt(700);
    expect(panel.dataset.placement).toBe('above');
    expect(px(panel.style.top)).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it('is visible (not stuck in the hidden measuring pass) once placed', () => {
    const panel = openPopoverWithTriggerAt(700);
    expect(panel.style.visibility).not.toBe('hidden');
  });

  it('stays inside the viewport for every trigger position down the page', () => {
    for (const top of [0, 40, 120, 180, 300, 450, 600, 750, 860]) {
      cleanup();
      const panel = openPopoverWithTriggerAt(top);
      const panelTop = px(panel.style.top);
      const panelMax = px(panel.style.maxHeight);
      expect(panelTop, `trigger at ${top}`).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
      expect(panelTop + panelMax, `trigger at ${top}`).toBeLessThanOrEqual(
        VIEWPORT_HEIGHT - POPOVER_VIEWPORT_MARGIN
      );
      expect(panelMax, `trigger at ${top}`).toBeGreaterThan(0);
    }
  });

  it('repositions instead of closing when the page scrolls under an open popover', () => {
    const panel = openPopoverWithTriggerAt(700);
    const before = px(panel.style.top);
    triggerTop = 180;
    act(() => {
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const stillOpen = screen.getByRole('dialog', { name: 'Help' });
    expect(px(stillOpen.style.top)).not.toBe(before);
    expect(px(stillOpen.style.top)).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it('recomputes a bounded box when the viewport is resized smaller', () => {
    const panel = openPopoverWithTriggerAt(700);
    window.innerHeight = 420;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const resized = screen.getByRole('dialog', { name: 'Help' });
    expect(px(resized.style.top)).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
    expect(px(resized.style.top) + px(resized.style.maxHeight)).toBeLessThanOrEqual(
      420 - POPOVER_VIEWPORT_MARGIN
    );
  });

  it('still closes on Escape', () => {
    openPopoverWithTriggerAt(700);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });

  it('still closes via the Close button', () => {
    openPopoverWithTriggerAt(700);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });
});
