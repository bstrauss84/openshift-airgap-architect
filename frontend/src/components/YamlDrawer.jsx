/**
 * OpenShift Airgap Architect - YAML Drawer Component
 *
 * Right-side resizable drawer for displaying generated YAML configurations
 * (install-config.yaml, agent-config.yaml, imageset-config.yaml) with
 * syntax highlighting, security obfuscation, and download capabilities.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { obfuscateYaml } from "../utils/yamlObfuscation.js";

const DRAWER_Z = 10072; // Between Feedback (10070) and Modals (10080)
const MIN_WIDTH = 350;
const MAX_WIDTH_PX = 800;

function FocusTrap({ children, onClose, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const focusables = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first) first.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div ref={ref} className={className}>{children}</div>;
}

export default function YamlDrawer({
  isOpen,
  onClose,
  previewFiles = {},
  activeStepId,
  scenario = {},
  showIncompleteWarning = false,
  loading = false,
  error = ""
}) {
  // State for drawer width (persisted to localStorage)
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = localStorage.getItem('yamlDrawerWidth');
    return saved ? parseInt(saved, 10) : 450;
  });

  // State for showing sensitive values toggle
  const [showSensitive, setShowSensitive] = useState(false);

  // State for agent-based split view ratio
  const [splitRatio, setSplitRatio] = useState(0.5); // 0-1, represents install-config percentage

  // Refs for drag-resize
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Persist drawer width to localStorage
  useEffect(() => {
    localStorage.setItem('yamlDrawerWidth', String(drawerWidth));
  }, [drawerWidth]);

  // Handle vertical drag-resize (width adjustment)
  const handleResizeStart = (e) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = drawerWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleResizeMove = (e) => {
      if (!resizingRef.current) return;
      const deltaX = startXRef.current - e.clientX; // Negative delta = expand right
      let newWidth = startWidthRef.current + deltaX;

      // Apply min/max constraints
      const maxWidth = Math.min(MAX_WIDTH_PX, window.innerWidth * 0.5);
      newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));

      setDrawerWidth(newWidth);
    };

    const handleResizeEnd = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Download file helper
  const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Render single config (install-config or imageset-config)
  const renderSingleConfig = (filename) => {
    const content = previewFiles[filename] || '';
    const displayContent = obfuscateYaml(content, showSensitive);

    return (
      <div className="yaml-config-pane" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{filename}</h3>
          <button
            type="button"
            className="ghost small"
            onClick={() => downloadFile(content, filename)}
            disabled={!content}
          >
            Download
          </button>
        </div>
        {loading && <p className="subtle">Generating...</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && content && (
          <pre className="yaml-preview" style={{
            background: 'var(--code-bg, #f5f5f5)',
            color: 'var(--code-color, #333)',
            padding: 12,
            borderRadius: 4,
            overflowX: 'auto',
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            margin: 0
          }}>
            <code>{displayContent}</code>
          </pre>
        )}
        {!loading && !error && !content && (
          <p className="subtle">No configuration available yet.</p>
        )}
      </div>
    );
  };

  // Render agent-based split view (install-config + agent-config)
  const renderSplitView = () => {
    const installContent = previewFiles['install-config.yaml'] || '';
    const agentContent = previewFiles['agent-config.yaml'] || '';
    const installDisplay = obfuscateYaml(installContent, showSensitive);
    const agentDisplay = obfuscateYaml(agentContent, showSensitive);

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Install config pane */}
        <div style={{ flex: splitRatio, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>install-config.yaml</h3>
              <button
                type="button"
                className="ghost small"
                onClick={() => downloadFile(installContent, 'install-config.yaml')}
                disabled={!installContent}
              >
                Download
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <pre className="yaml-preview" style={{
              background: 'var(--code-bg, #f5f5f5)',
              color: 'var(--code-color, #333)',
              padding: 12,
              borderRadius: 4,
              overflowX: 'auto',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              margin: 0
            }}>
              <code>{installDisplay || 'No install-config available yet.'}</code>
            </pre>
          </div>
        </div>

        {/* Horizontal drag handle */}
        <div
          className="yaml-split-handle"
          style={{
            height: 12,
            cursor: 'ns-resize',
            background: 'linear-gradient(to bottom, transparent 0%, transparent 45%, var(--border-color) 45%, var(--border-color) 55%, transparent 55%, transparent 100%)',
            transition: 'background 150ms'
          }}
          onMouseDown={(e) => {
            // TODO: Implement horizontal split resize in Phase 4
            e.preventDefault();
          }}
        />

        {/* Agent config pane */}
        <div style={{ flex: 1 - splitRatio, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>agent-config.yaml</h3>
              <button
                type="button"
                className="ghost small"
                onClick={() => downloadFile(agentContent, 'agent-config.yaml')}
                disabled={!agentContent}
              >
                Download
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            <pre className="yaml-preview" style={{
              background: 'var(--code-bg, #f5f5f5)',
              color: 'var(--code-color, #333)',
              padding: 12,
              borderRadius: 4,
              overflowX: 'auto',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              margin: 0
            }}>
              <code>{agentDisplay || 'No agent-config available yet.'}</code>
            </pre>
          </div>
        </div>
      </div>
    );
  };

  // Render ImageSet config with switching logic
  const renderImageSetWithSwitching = () => {
    // TODO: Implement uploaded vs generated switching in Phase 5
    return renderSingleConfig('imageset-config.yaml');
  };

  // Main config rendering logic
  const renderConfigs = () => {
    // Operators tab: show ImageSet only
    if (activeStepId === 'operators') {
      return renderSingleConfig('imageset-config.yaml');
    }

    // Run oc-mirror: show ImageSet with switching logic
    if (activeStepId === 'run-oc-mirror') {
      return renderImageSetWithSwitching();
    }

    // Agent-based: split view
    if (scenario.isAgentBased) {
      return renderSplitView();
    }

    // Default: install-config only
    return renderSingleConfig('install-config.yaml');
  };

  const content = (
    <>
      <div
        className="yaml-drawer-backdrop"
        role="presentation"
        aria-hidden
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: DRAWER_Z,
          background: "rgba(0,0,0,0.35)"
        }}
      />
      <div
        className="yaml-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="yaml-drawer-title"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: `${drawerWidth}px`,
          zIndex: DRAWER_Z + 1,
          background: 'var(--card-bg)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: 'transform 200ms ease-out',
          transform: 'translateX(0)'
        }}
      >
        {/* Vertical drag-resize handle (left edge) */}
        <div
          className="yaml-drawer-resize-handle"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: 'col-resize',
            background: 'transparent',
            transition: 'background 150ms',
            zIndex: 10
          }}
          onMouseDown={handleResizeStart}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(14, 165, 233, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        />

        <FocusTrap onClose={onClose} className="yaml-drawer-focus-trap" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div
            className="yaml-drawer-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)'
            }}
          >
            <h2 id="yaml-drawer-title" className="card-title" style={{ margin: 0, flex: 1 }}>
              YAML Preview
            </h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showSensitive}
                onChange={(e) => setShowSensitive(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Show sensitive values</span>
            </label>
            <button
              type="button"
              className="ghost icon-button"
              onClick={onClose}
              aria-label="Close YAML Preview"
            >
              ✕
            </button>
          </div>

          {/* Incomplete warning */}
          {showIncompleteWarning && (
            <div className="note warning" style={{ margin: 16, marginBottom: 0 }}>
              ⚠️ <strong>Incomplete Configuration:</strong> Required fields are missing. Complete the current step to generate a valid configuration.
            </div>
          )}

          {/* Content area */}
          <div
            className="yaml-drawer-content"
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {renderConfigs()}
          </div>
        </FocusTrap>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
