import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_Z_INDEX = 10050;

/**
 * Field label with inline "( i )" that shows a tooltip. Tooltip is portaled to document.body
 * so it never clips under sidebar or cards. Placement: above or right of icon to stay in viewport.
 */
function FieldLabelWithInfo({ label, hint, required, id: idProp }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [placement, setPlacement] = useState("above");
  const iconRef = useRef(null);
  const id = idProp || `field-info-${Math.random().toString(36).slice(2, 9)}`;

  const gap = 8;
  const tooltipMaxWidth = 280;

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
          >
            <div className="field-tooltip-content">{hint}</div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div className="field-label-with-info">
        <span className="field-label-line">
          <span className="field-label-text">{label}</span>
          {required ? <span className="required-marker" aria-label="required">*</span> : null}
          {hint ? (
            <span className="field-label-icon-wrap" style={{ whiteSpace: "nowrap" }}>
              {"\u00A0"}
              <button
                ref={iconRef}
                type="button"
                className="field-info-icon"
                aria-label="More information"
                aria-describedby={visible ? id : undefined}
                onClick={() => setVisible((v) => !v)}
                onBlur={() => setVisible(false)}
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
              >
                <img src="/info-icon.png" alt="" className="field-info-icon-img" />
              </button>
            </span>
          ) : null}
        </span>
      </div>
      {tooltipEl}
    </>
  );
}

export default FieldLabelWithInfo;
