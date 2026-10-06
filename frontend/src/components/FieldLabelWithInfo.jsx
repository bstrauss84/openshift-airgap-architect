/**
 * OpenShift Airgap Architect - Field Label with Info Icon Component
 *
 * Field label with inline info icon that shows contextual help.
 * Short hints (<180 chars): hover tooltip; Long hints: click-triggered scrollable popover.
 * Supports accessibility with ARIA attributes and keyboard navigation.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { computePopoverPlacement, POPOVER_TRIGGER_GAP } from "../shared/popoverPlacement.js";

const TOOLTIP_Z_INDEX = 10050;

/**
 * Design caps on panel height. Actual applied height is the smaller of these and
 * the space the viewport really has — see computePopoverPlacement.
 */
const TOOLTIP_PREFERRED_MAX_HEIGHT = 200;
const POPOVER_PREFERRED_MAX_HEIGHT = 360;
const POPOVER_PREFERRED_MAX_VH = 0.7;

/**
 * Character count above which the hint is shown in a click-triggered persistent popover
 * instead of a hover tooltip, so long content can be read and scrolled reliably.
 */
const LONG_HINT_CHARS = 180;

/**
 * Field label with inline "( i )" that shows a tooltip or help popover.
 * - Short hints (<= LONG_HINT_CHARS): hover tooltip (with leave delay so user can move into it to scroll).
 * - Long hints: click-triggered persistent popover; stays open until Escape or click outside; content is scrollable.
 * Tooltip/popover is portaled to document.body. Icon is inline after the title.
 * When a hint is present, the title is split so the help icon stays in a non‑breaking
 * group with the last word (see splitLabelPrefixAndLastWord). The icon is not nested
 * inside a label that uses htmlFor, so the control does not get duplicate accessible names.
 */
const TOOLTIP_LEAVE_DELAY_MS = 120;

/**
 * Split title into a wrapping prefix and a final "word" so the help icon can sit in a
 * nowrap group with that word — the icon must never sit alone on its own line.
 */
export function splitLabelPrefixAndLastWord(label) {
  const t = String(label ?? "").trim();
  if (!t) return { prefix: "", last: "" };
  const words = t.split(/\s+/u);
  if (words.length < 2) return { prefix: "", last: t };
  return {
    prefix: words.slice(0, -1).join(" "),
    last: words[words.length - 1]
  };
}

/**
 * Parse hint text to convert **bold** markdown syntax to <strong> tags.
 * Preserves line breaks (\n) for white-space: pre-wrap CSS.
 */
function parseHintMarkdown(text) {
  if (!text || typeof text !== 'string') return text;

  const parts = [];
  let lastIndex = 0;
  const boldRegex = /\*\*([^*]+?)\*\*/g;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    // Add bold text as <strong>
    parts.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function FieldLabelWithInfo({ label, hint, required, id: idProp, children, className: wrapperClassName }) {
  const [visible, setVisible] = useState(false);
  // null while the panel is being measured (first paint, off-screen and hidden).
  const [panelBox, setPanelBox] = useState(null);
  const iconRef = useRef(null);
  const popoverRef = useRef(null);
  const naturalSizeRef = useRef(null);
  const leaveTimeoutRef = useRef(null);
  const id = idProp || `field-info-${Math.random().toString(36).slice(2, 9)}`;
  const controlIdRef = useRef(null);
  if (controlIdRef.current === null && children != null) {
    controlIdRef.current = `field-control-${Math.random().toString(36).slice(2, 11)}`;
  }
  const controlId = children != null ? (React.Children.only(children)?.props?.id ?? controlIdRef.current) : null;

  const isLongHint = hint && hint.length > LONG_HINT_CHARS;
  const gap = POPOVER_TRIGGER_GAP;
  const tooltipMaxWidth = 320;
  const popoverMaxWidth = 380;
  const maxWidth = isLongHint ? popoverMaxWidth : tooltipMaxWidth;

  /**
   * Position the panel from its measured natural size and the real space the
   * viewport has above/below the trigger. Never lays the panel out past the
   * usable viewport: it flips, then clamps and bounds its height so overflowing
   * content scrolls inside the panel rather than off-screen.
   */
  const reposition = useCallback(() => {
    const trigger = iconRef.current;
    const natural = naturalSizeRef.current;
    if (!trigger || !natural) return;
    const viewportHeight = window.innerHeight;
    const preferredMaxHeight = isLongHint
      ? Math.min(POPOVER_PREFERRED_MAX_HEIGHT, viewportHeight * POPOVER_PREFERRED_MAX_VH)
      : TOOLTIP_PREFERRED_MAX_HEIGHT;
    setPanelBox(
      computePopoverPlacement({
        triggerRect: trigger.getBoundingClientRect(),
        panelWidth: natural.width,
        panelHeight: natural.height,
        viewportWidth: window.innerWidth,
        viewportHeight,
        gap,
        preferredMaxHeight,
        preferAbove: true
      })
    );
  }, [isLongHint, gap]);

  // Measure the panel at its natural height on the paint after it opens, then
  // position it. Measuring first is what makes flip/clamp decisions correct —
  // the previous implementation guessed from a fixed 120px threshold.
  useLayoutEffect(() => {
    if (!visible || !hint) {
      naturalSizeRef.current = null;
      setPanelBox(null);
      return;
    }
    if (panelBox !== null) return;
    const panel = popoverRef.current;
    if (!panel) return;
    naturalSizeRef.current = {
      width: panel.offsetWidth || maxWidth,
      height: panel.offsetHeight || 0
    };
    reposition();
  }, [visible, hint, panelBox, reposition, maxWidth]);

  useEffect(() => {
    if (!visible || !hint) return;
    const onScroll = (e) => {
      // e.target is `window`/`document` for page-level scrolls, which Node.contains rejects.
      const target = e.target instanceof Node ? e.target : null;
      if (target && popoverRef.current?.contains(target)) return;
      // Long-hint popovers are persistent: follow the trigger instead of
      // closing, so the panel stays reachable while the page moves.
      if (isLongHint) {
        reposition();
        return;
      }
      setVisible(false);
    };
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible, hint, isLongHint, reposition]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setVisible(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  // Click-outside close for long-hint popover only
  useEffect(() => {
    if (!visible || !isLongHint) return;
    const onPointerDown = (e) => {
      const btn = iconRef.current;
      const panel = popoverRef.current;
      if (btn?.contains(e.target) || panel?.contains(e.target)) return;
      setVisible(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [visible, isLongHint]);

  const scheduleClose = () => {
    if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    leaveTimeoutRef.current = setTimeout(() => setVisible(false), TOOLTIP_LEAVE_DELAY_MS);
  };
  const cancelClose = () => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  };

  // First paint renders the panel hidden and unconstrained so its natural size
  // can be measured; the second paint applies the clamped box.
  const measuring = panelBox === null;
  const panelContent = visible && hint ? (
    <div
      ref={popoverRef}
      id={id}
      role={isLongHint ? "dialog" : "tooltip"}
      aria-label={isLongHint ? "Help" : undefined}
      data-placement={measuring ? undefined : panelBox.placement}
      className={isLongHint ? "field-tooltip-portal field-help-popover" : "field-tooltip-portal"}
      style={{
        position: "fixed",
        top: measuring ? 0 : panelBox.top,
        left: measuring ? 0 : panelBox.left,
        maxWidth,
        maxHeight: measuring ? "none" : panelBox.maxHeight,
        visibility: measuring ? "hidden" : undefined,
        zIndex: TOOLTIP_Z_INDEX
      }}
      onMouseEnter={isLongHint ? undefined : () => { cancelClose(); setVisible(true); }}
      onMouseLeave={isLongHint ? undefined : () => { setVisible(false); }}
    >
      <div className={isLongHint ? "field-help-popover-content" : "field-tooltip-content"}>{parseHintMarkdown(hint)}</div>
      {isLongHint ? (
        <div className="field-help-popover-actions">
          <button type="button" className="ghost" onClick={() => setVisible(false)}>Close</button>
        </div>
      ) : null}
    </div>
  ) : null;

  const tooltipEl = panelContent ? createPortal(panelContent, document.body) : null;

  const labelContent = (
    <>
      <span className="field-label-text">{label}</span>
      {required ? <span className="required-marker" aria-label="required">*</span> : null}
    </>
  );

  const { prefix: titlePrefix, last: titleLast } = hint ? splitLabelPrefixAndLastWord(label) : { prefix: "", last: "" };

  const iconButton = hint ? (
    <button
      ref={iconRef}
      type="button"
      className="field-info-icon"
      tabIndex="-1"
      aria-label={isLongHint ? "Open help (click to read)" : "More information"}
      aria-describedby={visible ? id : undefined}
      aria-expanded={isLongHint ? visible : undefined}
      style={{ userSelect: "none" }}
      onClick={() => setVisible((v) => !v)}
      onBlur={() => { if (!isLongHint) { cancelClose(); setVisible(false); } }}
      onMouseEnter={isLongHint ? undefined : () => { cancelClose(); setVisible(true); }}
      onMouseLeave={isLongHint ? undefined : scheduleClose}
    >
      <img src="/info-icon.png" alt="" className="field-info-icon-img" />
    </button>
  ) : null;

  if (children != null) {
    const child = React.Children.only(children);
    const childId = child?.props?.id ?? controlIdRef.current;
    const clonedChild = childId ? React.cloneElement(child, { id: childId }) : child;
    return (
      <>
        <div className={["field-with-info-row", wrapperClassName].filter(Boolean).join(" ")}>
          <span className="field-title-line">
            <span className="field-title-and-icon-keep-together">
              {hint ? (
                <>
                  {titlePrefix ? (
                    <label htmlFor={childId} className="field-label-inline field-label-prefix">
                      {titlePrefix}{" "}
                    </label>
                  ) : null}
                  <span className="field-label-last-with-icon">
                    <label htmlFor={childId} className="field-label-inline">
                      <span className="field-label-text">{titleLast}</span>
                      {required ? <span className="required-marker" aria-label="required">*</span> : null}
                    </label>
                    {iconButton}
                  </span>
                </>
              ) : (
                <label htmlFor={childId} className="field-label-inline">
                  {labelContent}
                </label>
              )}
            </span>
          </span>
          {clonedChild}
        </div>
        {tooltipEl}
      </>
    );
  }

  return (
    <>
      <div className="field-label-with-info">
        <span className="field-label-line">
          {hint ? (
            <>
              {titlePrefix ? <span className="field-label-prefix">{titlePrefix} </span> : null}
              <span className="field-label-last-with-icon">
                <span className="field-label-text">{titleLast}</span>
                {required ? <span className="required-marker" aria-label="required">*</span> : null}
                {iconButton}
              </span>
            </>
          ) : (
            labelContent
          )}
        </span>
      </div>
      {tooltipEl}
    </>
  );
}

export default FieldLabelWithInfo;
