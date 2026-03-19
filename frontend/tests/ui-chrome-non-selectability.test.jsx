import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import FieldLabelWithInfo from "../src/components/FieldLabelWithInfo.jsx";
import Button from "../src/components/Button.jsx";

describe("UI chrome non-selectability", () => {
  it("sets user-select: none on field info icon button", () => {
    render(
      <FieldLabelWithInfo label="Test" hint="Short help">
        <input aria-label="dummy" />
      </FieldLabelWithInfo>
    );

    const iconBtn = screen.getByRole("button", { name: /more information/i });
    expect(iconBtn).toHaveStyle({ userSelect: "none" });
  });

  it("sets user-select: none on Button component", () => {
    render(<Button variant="primary" aria-label="primary action">Primary</Button>);
    const btn = screen.getByRole("button", { name: /primary action/i });
    expect(btn).toHaveStyle({ userSelect: "none" });
  });
});

