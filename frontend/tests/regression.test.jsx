/**
 * Regression tests for critical bugs fixed during development.
 * These tests ensure that previously fixed issues don't reoccur.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import FieldLabelWithInfo from '../src/components/FieldLabelWithInfo';
import Switch from '../src/components/Switch';

describe('Regression Tests', () => {
  describe('[object Object] bug prevention', () => {
    it('should accept string labels without throwing React.Children.only error', () => {
      // This test ensures that FieldLabelWithInfo receives a string label,
      // not a JSX object which would cause "[object Object]" rendering
      expect(() => {
        render(
          <FieldLabelWithInfo label="Test Label" hint="Test hint">
            <input type="text" />
          </FieldLabelWithInfo>
        );
      }).not.toThrow();
    });

    it('should render label text correctly without stringifying JSX', () => {
      const { container } = render(
        <FieldLabelWithInfo label="Test Field" hint="Test hint" required>
          <input type="text" />
        </FieldLabelWithInfo>
      );

      // Should show "Test Field" text, not "[object Object]"
      // Text may be split across multiple elements due to hint icon placement
      expect(container.textContent).toContain('Test Field');
    });

    it('should render with single child element correctly', () => {
      // Regression test: Field error messages must be OUTSIDE FieldLabelWithInfo,
      // not as additional children which would cause React.Children.only error
      const { container } = render(
        <div>
          <FieldLabelWithInfo label="Test Field" hint="Test hint">
            <input type="text" />
          </FieldLabelWithInfo>
          <div className="field-error">Error message goes outside</div>
        </div>
      );

      expect(container.querySelector('input')).toBeTruthy();
      expect(container.querySelector('.field-error')).toBeTruthy();
    });
  });

  describe('Switch component accessibility (prevents scroll-into-view bug)', () => {
    it('should use button role instead of checkbox to avoid scroll issues', () => {
      const { container } = render(
        <Switch
          checked={false}
          onChange={() => {}}
          aria-label="Test switch"
        />
      );

      const button = container.querySelector('button[role="switch"]');
      expect(button).toBeTruthy();

      // Should NOT have a hidden checkbox that triggers scroll-into-view
      const checkbox = container.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeFalsy();
    });

    it('should have aria-checked attribute for screen readers', () => {
      const { container } = render(
        <Switch
          checked={true}
          onChange={() => {}}
          aria-label="Test switch"
        />
      );

      const button = container.querySelector('button[role="switch"]');
      expect(button.getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('Required marker rendering', () => {
    it('should render required marker when required=true', () => {
      const { container } = render(
        <FieldLabelWithInfo label="Required Field" hint="Test hint" required>
          <input type="text" />
        </FieldLabelWithInfo>
      );

      const requiredMarker = container.querySelector('.required-marker');
      expect(requiredMarker).toBeTruthy();
      expect(requiredMarker.textContent).toBe('*');
      expect(requiredMarker.getAttribute('aria-label')).toBe('required');
    });

    it('should not render required marker when required=false', () => {
      const { container } = render(
        <FieldLabelWithInfo label="Optional Field" hint="Test hint" required={false}>
          <input type="text" />
        </FieldLabelWithInfo>
      );

      const requiredMarker = container.querySelector('.required-marker');
      expect(requiredMarker).toBeFalsy();
    });
  });
});
