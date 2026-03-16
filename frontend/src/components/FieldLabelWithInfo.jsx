import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_Z_INDEX = 10050;

/**
 * Field label with inline "( i )" that shows a tooltip. Tooltip is portaled to document.body
 * so it never clips under sidebar or cards. Placement: above or right of icon to stay in viewport.
 * Icon is always placed immediately after the last character of the title (same line), never on its own row.
 * When children (a form control) is passed, the label uses htmlFor so clicking the title focuses the control;
 * the icon is a sibling of the label so it stays inline after the title (same visual as SecretInput/reference).
 */
const TOOLTIP_LEAVE_DELAY_MS = 120;

function FieldLabelWithInfo({ label, hint, required, id: idProp, children, className: wrapperClassName }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [placement, setPlacement] = useState("above");
  const iconRef = useRef(null);
  const leaveTimeoutRef = useRef(null);
  const id = idProp || `field-info-${Math.random().toString(36).slice(2, 9)}`;
  const controlIdRef = useRef(null);
  if (controlIdRef.current === null && children != null) {
    controlIdRef.current = `field-control-${Math.random().toString(36).slice(2, 11)}`;
  }
  const controlId = children != null ? (React.Children.only(children)?.props?.id ?? controlIdRef.current) : null;

  const gap = 8;
  const tooltipMaxWidth = 320;

  const updatePosition = () => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    if (rect.top >= 120) {
      setPlacement("above");
      setPosition({
        top: rect.top - gap,
        left: Math.max(16, Math.min(rect.left, vw - tooltipMaxWidth - 16)),
        maxWidth: tooltipMaxWidth
      });
    } else {
      setPlacement("right");
      setPosition({
        top: rect.top,
        left: Math.min(rect.right + gap, vw - tooltipMaxWidth - 16),
        maxWidth: tooltipMaxWidth
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

  const tooltipEl =
    visible && hint
      ? createPortal(
          <div
            id={id}
            role="tooltip"
            className="field-tooltip-portal"
            style={{
              position: "fixed",
              top: placement === "above" ? position.top - gap : position.top,
              left: position.left,
              maxWidth: position.maxWidth,
              zIndex: TOOLTIP_Z_INDEX,
              transform: placement === "above" ? "translateY(-100%)" : undefined
            }}
            onMouseEnter={() => { cancelClose(); setVisible(true); }}
            onMouseLeave={() => { setVisible(false); }}
          >
            <div className="field-tooltip-content">{hint}</div>
          </div>,
          document.body
        )
      : null;

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
      aria-label="More information"
      aria-describedby={visible ? id : undefined}
      onClick={() => setVisible((v) => !v)}
      onBlur={() => { cancelClose(); setVisible(false); }}
      onMouseEnter={() => { cancelClose(); setVisible(true); }}
      onMouseLeave={scheduleClose}
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
