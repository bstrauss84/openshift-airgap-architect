import React from "react";

/**
 * Premium button with 3D hover/pressed animation.
 * Variants: primary (Install blue), secondary (neutral), destructive.
 */
function Button({
  variant = "secondary",
  type = "button",
  disabled = false,
  onClick,
  children,
  className = "",
  "aria-label": ariaLabel,
  style,
  ...rest
}) {
  const variantClass =
    variant === "primary"
      ? "primary"
      : variant === "destructive"
        ? "danger"
        : "ghost";

  return (
    <button
      type={type}
      className={`${variantClass} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      style={{ userSelect: "none", ...(style || {}) }}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
