/**
 * Focus trap hook for modal dialogs.
 * Traps keyboard focus within a container element, cycling through focusable elements.
 * Restores focus to triggering element when trap is released.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { useEffect, useRef } from 'react';

/**
 * Custom hook to trap focus within a modal/dialog element.
 *
 * @param {boolean} isActive - Whether the focus trap should be active
 * @returns {React.RefObject} - Ref to attach to the container element
 *
 * @example
 * const Modal = ({ isOpen, onClose }) => {
 *   const trapRef = useFocusTrap(isOpen);
 *   return isOpen ? (
 *     <div ref={trapRef} className="modal" role="dialog">
 *       <button onClick={onClose}>Close</button>
 *     </div>
 *   ) : null;
 * };
 */
export const useFocusTrap = (isActive) => {
  const containerRef = useRef(null);
  const previousActiveElement = useRef(null);

  useEffect(() => {
    if (!isActive) return;

    // Store the element that had focus before modal opened
    previousActiveElement.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    // Get all focusable elements within the container
    const getFocusableElements = () => {
      const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
      ].join(',');

      return Array.from(container.querySelectorAll(focusableSelectors))
        .filter(el => {
          // Filter out elements that are not visible
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
    };

    // Focus the first focusable element
    const initialFocus = () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    };

    // Handle Tab key to cycle focus within container
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: move backwards
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: move forwards
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Set initial focus after a brief delay to ensure modal is rendered
    const timer = setTimeout(initialFocus, 50);

    // Add event listener
    container.addEventListener('keydown', handleKeyDown);

    // Cleanup function
    return () => {
      clearTimeout(timer);
      container.removeEventListener('keydown', handleKeyDown);

      // Restore focus to previous element when trap is released
      if (previousActiveElement.current && previousActiveElement.current.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [isActive]);

  return containerRef;
};
