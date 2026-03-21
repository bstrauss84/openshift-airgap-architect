import React from "react";

/**
 * Consistent option row: left = title + description, right = control (e.g. Switch).
 * Optional note or warning below the description (only when provided).
 *
 * Pass htmlFor (matching the id of a radio/checkbox input inside children) to make
 * the title and description area a clickable <label> that activates the input.
 */
function OptionRow({ title, description, children, note, warning, id, htmlFor }) {
  // When htmlFor is provided, wrap the text area in a <label> so clicking
  // the title or description selects the associated radio/checkbox input.
  const TextWrapper = htmlFor ? "label" : "div";
  const textProps = htmlFor
    ? { htmlFor, className: "option-row-text", style: { cursor: "pointer" } }
    : { className: "option-row-text" };
  return (
    <div className="option-row" id={id}>
      <div className="option-row-main">
        <TextWrapper {...textProps}>
          <span className="option-row-title">{title}</span>
          {description ? (
            <span className="option-row-desc">{description}</span>
          ) : null}
        </TextWrapper>
        <div className="option-row-control">
          {children}
        </div>
      </div>
      {note && !warning ? (
        <p className="option-row-note">{note}</p>
      ) : null}
      {warning ? (
        <div className="warning-callout">{warning}</div>
      ) : null}
    </div>
  );
}

export default OptionRow;
