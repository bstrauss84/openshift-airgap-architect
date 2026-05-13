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
import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import { obfuscateYaml } from "../utils/yamlObfuscation.js";

const MIN_WIDTH = 350;
const MAX_WIDTH_PX = 800;
const DEFAULT_WIDTH = 450;
const DEFAULT_SPLIT_RATIO = 0.5;

export default function YamlDrawer({
  isOpen,
  onClose,
  previewFiles = {},
  activeStepId,
  scenario = {},
  showIncompleteWarning = false,
  loading = false,
  error = "",
  resetSizing = false
}) {
  // State for drawer width (persisted to localStorage, reset on close)
  const [drawerWidth, setDrawerWidth] = useState(() => {
    if (resetSizing) return DEFAULT_WIDTH;
    const saved = localStorage.getItem('yamlDrawerWidth');
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  // State for showing sensitive values toggle
  const [showSensitive, setShowSensitive] = useState(false);

  // State for agent-based split view ratio (persisted to localStorage, reset on close)
  const [splitRatio, setSplitRatio] = useState(() => {
    if (resetSizing) return DEFAULT_SPLIT_RATIO;
    const saved = localStorage.getItem('yamlDrawerSplitRatio');
    return saved ? parseFloat(saved) : DEFAULT_SPLIT_RATIO;
  });

  // Refs for drag-resize (vertical - width)
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Refs for horizontal split resize (height split in agent view)
  const splitResizingRef = useRef(false);
  const splitStartYRef = useRef(0);
  const splitStartRatioRef = useRef(0);
  const splitContainerRef = useRef(null);

  // Persist drawer width and split ratio to localStorage
  useEffect(() => {
    localStorage.setItem('yamlDrawerWidth', String(drawerWidth));
  }, [drawerWidth]);

  useEffect(() => {
    localStorage.setItem('yamlDrawerSplitRatio', String(splitRatio));
  }, [splitRatio]);

  // Reset sizing when resetSizing prop changes to true
  useEffect(() => {
    if (resetSizing) {
      setDrawerWidth(DEFAULT_WIDTH);
      setSplitRatio(DEFAULT_SPLIT_RATIO);
    }
  }, [resetSizing]);

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

  // Handle horizontal split resize (agent-based split view)
  const handleSplitResizeStart = (e) => {
    e.preventDefault();
    splitResizingRef.current = true;
    splitStartYRef.current = e.clientY;
    splitStartRatioRef.current = splitRatio;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleSplitResizeMove = (e) => {
      if (!splitResizingRef.current || !splitContainerRef.current) return;

      const containerHeight = splitContainerRef.current.clientHeight;
      const deltaY = e.clientY - splitStartYRef.current;
      const deltaRatio = deltaY / containerHeight;
      let newRatio = splitStartRatioRef.current + deltaRatio;

      // Apply min constraints (120px each pane minimum)
      const minRatio = 120 / containerHeight;
      const maxRatio = 1 - minRatio;
      newRatio = Math.max(minRatio, Math.min(newRatio, maxRatio));

      setSplitRatio(newRatio);
    };

    const handleSplitResizeEnd = () => {
      if (!splitResizingRef.current) return;
      splitResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleSplitResizeMove);
    document.addEventListener('mouseup', handleSplitResizeEnd);

    return () => {
      document.removeEventListener('mousemove', handleSplitResizeMove);
      document.removeEventListener('mouseup', handleSplitResizeEnd);
    };
  }, [splitRatio]);

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

    // Memoize Prism highlighting to avoid expensive re-renders on every keystroke
    const highlightedHtml = React.useMemo(() => {
      return displayContent ? Prism.highlight(displayContent, Prism.languages.yaml, 'yaml') : '';
    }, [displayContent]);

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
          <pre className="yaml-preview language-yaml" style={{
            background: 'var(--code-bg, #f5f5f5)',
            color: 'var(--code-color, #333)',
            padding: 12,
            borderRadius: 4,
            overflowX: 'auto',
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            margin: 0
          }}>
            <code
              className="language-yaml"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
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
    // Show skeleton YAML while waiting for agent-config API response
    const agentDisplay = agentContent ?
      obfuscateYaml(agentContent, showSensitive) :
      `apiVersion: v1beta1
kind: AgentConfig
metadata:
  name: ${installContent.match(/name:\s*(\S+)/)?.[1] || 'cluster-name'}
# Loading...`;

    // NOTE: useMemo removed from here to fix React Hooks violation
    // Highlighting is now done inline without memoization
    const installHighlighted = installDisplay ? Prism.highlight(installDisplay, Prism.languages.yaml, 'yaml') : '';
    const agentHighlighted = agentDisplay ? Prism.highlight(agentDisplay, Prism.languages.yaml, 'yaml') : '';

    return (
      <div ref={splitContainerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
            <pre className="yaml-preview language-yaml" style={{
              background: 'var(--code-bg, #f5f5f5)',
              color: 'var(--code-color, #333)',
              padding: 12,
              borderRadius: 4,
              overflowX: 'auto',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              margin: 0
            }}>
              <code
                className="language-yaml"
                dangerouslySetInnerHTML={{ __html: installHighlighted || 'No install-config available yet.' }}
              />
            </pre>
          </div>
        </div>

        {/* Horizontal drag handle */}
        <div
          className="yaml-split-handle"
          role="separator"
          aria-label="Resize split between install-config and agent-config"
          aria-orientation="horizontal"
          tabIndex={0}
          style={{
            height: 12,
            cursor: 'ns-resize',
            background: 'linear-gradient(to bottom, transparent 0%, transparent 45%, var(--border-color) 45%, var(--border-color) 55%, transparent 55%, transparent 100%)',
            transition: 'background 150ms'
          }}
          onMouseDown={handleSplitResizeStart}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(37, 99, 235, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(to bottom, transparent 0%, transparent 45%, var(--border-color) 45%, var(--border-color) 55%, transparent 55%, transparent 100%)';
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
            <pre className="yaml-preview language-yaml" style={{
              background: 'var(--code-bg, #f5f5f5)',
              color: 'var(--code-color, #333)',
              padding: 12,
              borderRadius: 4,
              overflowX: 'auto',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              margin: 0
            }}>
              <code
                className="language-yaml"
                dangerouslySetInnerHTML={{ __html: agentHighlighted || 'No agent-config available yet.' }}
              />
            </pre>
          </div>
        </div>
      </div>
    );
  };

  // Render ImageSet config with switching logic (Run oc-mirror tab)
  const renderImageSetWithSwitching = () => {
    const content = previewFiles['imageset-config.yaml'] || '';
    const displayContent = obfuscateYaml(content, showSensitive);

    // Memoize Prism highlighting to avoid expensive re-renders
    const highlightedHtml = React.useMemo(() => {
      return displayContent ? Prism.highlight(displayContent, Prism.languages.yaml, 'yaml') : '';
    }, [displayContent]);

    // TODO: When uploaded ImageSet config is stored in state, prioritize it over generated
    // Check state.ocMirror?.uploadedImageSetConfig or similar field
    const source = 'Generated'; // Will be 'Uploaded' when user provides their own

    return (
      <div className="yaml-config-pane" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>imageset-config.yaml</h3>
            <span style={{
              fontSize: '0.75rem',
              padding: '2px 6px',
              borderRadius: 3,
              background: source === 'Uploaded' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              color: source === 'Uploaded' ? 'rgb(22, 163, 74)' : 'rgb(37, 99, 235)',
              fontWeight: 500
            }}>
              {source}
            </span>
          </div>
          <button
            type="button"
            className="ghost small"
            onClick={() => downloadFile(content, 'imageset-config.yaml')}
            disabled={!content}
          >
            Download
          </button>
        </div>
        {loading && <p className="subtle">Generating...</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && content && (
          <pre className="yaml-preview language-yaml" style={{
            background: 'var(--code-bg, #f5f5f5)',
            color: 'var(--code-color, #333)',
            padding: 12,
            borderRadius: 4,
            overflowX: 'auto',
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            margin: 0
          }}>
            <code
              className="language-yaml"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        )}
        {!loading && !error && !content && (
          <div className="note" style={{ marginTop: 16 }}>
            <p><strong>No ImageSet configuration available yet.</strong></p>
            <p className="subtle" style={{ marginTop: 8, marginBottom: 0 }}>
              Complete the Operators tab to generate an ImageSet configuration, or upload your own on the Run oc-mirror tab.
            </p>
          </div>
        )}
      </div>
    );
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

  return (
    <div
      className="yaml-drawer-panel"
      role="region"
      aria-labelledby="yaml-drawer-title"
      style={{
        width: `${drawerWidth}px`,
        minWidth: `${MIN_WIDTH}px`,
        maxWidth: `${MAX_WIDTH_PX}px`,
        background: 'var(--card-bg)',
        borderLeft: '1px solid var(--border-color)',
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: 'relative',
        height: '100%'
      }}
    >
      {/* Vertical drag-resize handle (left edge) */}
      <div
        className="yaml-drawer-resize-handle"
        role="separator"
        aria-label="Resize drawer width"
        aria-orientation="vertical"
        tabIndex={0}
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
    </div>
  );
}
