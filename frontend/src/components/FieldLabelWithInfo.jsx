import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_Z_INDEX = 10050;

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
 * When children (a form control) is passed, the label uses htmlFor so clicking the title focuses the control.
 */
const TOOLTIP_LEAVE_DELAY_MS = 120;

function FieldLabelWithInfo({ label, hint, required, id: idProp, children, className: wrapperClassName }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [placement, setPlacement] = useState("above");
  const iconRef = useRef(null);
  const popoverRef = useRef(null);
  const leaveTimeoutRef = useRef(null);
  const id = idProp || `field-info-${Math.random().toString(36).slice(2, 9)}`;
  const controlIdRef = useRef(null);
  if (controlIdRef.current === null && children != null) {
    controlIdRef.current = `field-control-${Math.random().toString(36).slice(2, 11)}`;
  }
  const controlId = children != null ? (React.Children.only(children)?.props?.id ?? controlIdRef.current) : null;

  const isLongHint = hint && hint.length > LONG_HINT_CHARS;
  const gap = 8;
  const tooltipMaxWidth = 320;
  const popoverMaxWidth = 380;

  const updatePosition = () => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const maxW = isLongHint ? popoverMaxWidth : tooltipMaxWidth;
    if (rect.top >= 120) {
      setPlacement("above");
      setPosition({
        top: rect.top - gap,
        left: Math.max(16, Math.min(rect.left, vw - maxW - 16)),
        maxWidth: maxW
      });
    } else {
      setPlacement("right");
      setPosition({
        top: rect.top,
        left: Math.min(rect.right + gap, vw - maxW - 16),
        maxWidth: maxW
      });
    }
  };

  useEffect(() => {
    if (!visible || !hint) return;
    updatePosition();
    const onScroll = () => setVisible(false);
    const onResize = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible, hint]);

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

  const panelContent = visible && hint ? (
    <div
      ref={isLongHint ? popoverRef : undefined}
      id={id}
      role={isLongHint ? "dialog" : "tooltip"}
      aria-label={isLongHint ? "Help" : undefined}
      className={isLongHint ? "field-tooltip-portal field-help-popover" : "field-tooltip-portal"}
      style={{
        position: "fixed",
        top: placement === "above" ? position.top - gap : position.top,
        left: position.left,
        maxWidth: position.maxWidth,
        zIndex: TOOLTIP_Z_INDEX,
        transform: placement === "above" ? "translateY(-100%)" : undefined
      }}
      onMouseEnter={isLongHint ? undefined : () => { cancelClose(); setVisible(true); }}
      onMouseLeave={isLongHint ? undefined : () => { setVisible(false); }}
    >
      <div className={isLongHint ? "field-help-popover-content" : "field-tooltip-content"}>{hint}</div>
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

  const iconButton = hint ? (
    <button
      ref={iconRef}
      type="button"
      className="field-info-icon"
      aria-label={isLongHint ? "Open help (click to read)" : "More information"}
      aria-describedby={visible ? id : undefined}
      aria-expanded={isLongHint ? visible : undefined}
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
            <span className="field-title-and-icon-keep-together" style={{ whiteSpace: "nowrap" }}>
              <label htmlFor={childId} className="field-label-inline">
                {labelContent}
              </label>
              {" \u00A0"}
              {iconButton}
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
          {labelContent}
          {hint ? (
            <span className="field-label-icon-wrap" style={{ whiteSpace: "nowrap" }}>
              {"\u00A0"}
              {iconButton}
            </span>
          ) : null}
        </span>
      </div>
      {tooltipEl}
    </>
  );
}

export default FieldLabelWithInfo;
