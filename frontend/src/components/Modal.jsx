/**
 * OpenShift Airgap Architect - Modal Component
 *
 * Reusable modal dialog with focus trap, backdrop, and keyboard handling.
 * Provides consistent modal behavior across the application.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

/**
 * Modal dialog component with built-in accessibility features.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Callback when modal should close
 * @param {string} [props.ariaLabelledBy] - ID of element that labels the modal
 * @param {string} [props.className] - Additional CSS class for modal content
 * @param {React.ReactNode} props.children - Modal content
 * @param {boolean} [props.closeOnBackdropClick=true] - Whether clicking backdrop closes modal
 * @param {boolean} [props.closeOnEscape=true] - Whether Escape key closes modal
 *
 * @example
 * <Modal isOpen={showModal} onClose={() => setShowModal(false)} ariaLabelledBy="modal-title">
 *   <h3 id="modal-title">Confirm Action</h3>
 *   <p>Are you sure?</p>
 *   <div className="actions">
 *     <button onClick={() => setShowModal(false)}>Cancel</button>
 *     <button onClick={handleConfirm}>Confirm</button>
 *   </div>
 * </Modal>
 */
const Modal = ({
  isOpen,
  onClose,
  ariaLabelledBy,
  className = "modal",
  children,
  closeOnBackdropClick = true,
  closeOnEscape = true
}) => {
  const trapRef = useFocusTrap(isOpen);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      onClick={handleBackdropClick}
    >
      <div ref={trapRef} className={className}>
        {children}
      </div>
    </div>
  );
};

export default Modal;
