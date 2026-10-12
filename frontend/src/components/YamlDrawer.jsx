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
  /* DOC-227: per-artifact generation errors keyed by output filename. An
     error here belongs to ONE document and is routed to that document's pane
     only. `error` stays the global signal — nothing generated at all — and is
     the only thing that may affect every pane. */
  fileErrors = {},
  stale = false,
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

  /* DOC-227. Resolve the error that applies to ONE document.
     - its own per-artifact error, if its generator failed; otherwise
     - the global error, which only exists when nothing generated at all.
     A sibling artifact's failure resolves to nothing here, which is the whole
     point: an NMState problem in agent-config.yaml never labels
     imageset-config.yaml stale or disables its Download. */
  const errorFor = (filename) => {
    const own = fileErrors?.[filename];
    if (own) return typeof own === "string" ? own : String(own?.message || own);
    return error || "";
  };

  /* A document whose own generation failed is showing its last successful
     content by definition (Tranche 7C.4), so it is superseded regardless of
     the global `stale` flag. */
  const staleFor = (filename) => (fileErrors?.[filename] ? true : stale);

  /* Banner shown when the current state does not generate.
     DOC-160 refined (Tranche 7C.4): the document is no longer thrown away, so
     this must say plainly that what is on screen is the previous successful
     generation and not the current entry. Download remains disabled throughout,
     so stale YAML still cannot leave the app as current output.
     DOC-227: scoped to one document — `paneError`/`paneStale` are that
     document's own, not the drawer's. */
  const renderGenerationNotice = (hasContent, paneError, paneStale) => {
    if (!paneError) return null;
    return (
      <div
        className="note warning"
        role="status"
        data-preview-superseded={hasContent && paneStale ? "true" : "false"}
        style={{ marginBottom: 8 }}
      >
        <strong>Preview not updated:</strong> {paneError}
        {hasContent && (
          <div className="subtle" style={{ marginTop: 4 }}>
            Showing the last configuration that generated successfully — it does not
            reflect your current entry. Download stays disabled until this is fixed.
          </div>
        )}
      </div>
    );
  };

  /* The <pre> is rendered whenever there is content, including while a new
     generation is in flight. Gating it on `!loading` unmounted it on every
     regeneration; the scroll container then collapsed and the browser reset
     scrollTop to 0, which is why the preview jumped back to the top each time a
     field was edited and blurred. Keeping it mounted preserves the user's
     scroll position without any timer or artificial delay. */

  // Render single config (install-config or imageset-config)
  const renderSingleConfig = (filename) => {
    const content = previewFiles[filename] || '';
    const displayContent = obfuscateYaml(content, showSensitive);
    const paneError = errorFor(filename);
    const paneStale = staleFor(filename);

    // NOTE: useMemo removed to fix React Hooks violation
    // Highlighting is now done inline without memoization
    const highlightedHtml = displayContent ? Prism.highlight(displayContent, Prism.languages.yaml, 'yaml') : '';

    return (
      <div className="yaml-config-pane" data-artifact={filename} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{filename}</h3>
          <button
            type="button"
            className="ghost small"
            onClick={() => downloadFile(content, filename)}
            /* Fail closed, per document: while THIS artifact failed to
               generate, its content describes a state the user has moved away
               from and must not be handed over as current output. A sibling
               artifact's failure is not grounds to disable this one — that was
               the DOC-227 defect. */
            disabled={!content || !!paneError || loading}
          >
            Download
          </button>
        </div>
        {renderGenerationNotice(Boolean(content), paneError, paneStale)}
        {loading && !content && <p className="subtle">Generating...</p>}
        {content && (
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
        {!loading && !paneError && !content && (
          <p className="subtle">No configuration available yet.</p>
        )}
      </div>
    );
  };

  // Render agent-based split view (install-config + agent-config)
  const renderSplitView = () => {
    const installContent = previewFiles['install-config.yaml'] || '';
    const agentContent = previewFiles['agent-config.yaml'] || '';
    /* DOC-227: the two panes carry independent verdicts. The global notice
       above them is rendered only for a global failure (nothing generated),
       so a single error is never duplicated across panes. */
    const installOwnError = fileErrors?.['install-config.yaml'] || '';
    const agentOwnError = fileErrors?.['agent-config.yaml'] || '';
    const installError = errorFor('install-config.yaml');
    const agentError = errorFor('agent-config.yaml');
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

    /* This view once had no error gate at all, so a failed generation left the
       previous agent-based YAML on screen looking current and its per-pane
       Download handed that stale text over. It then swung the other way and
       replaced both documents with the error text. Neither is right: the
       notice below states plainly that the documents are superseded, and both
       Downloads are disabled while the current state does not generate — so
       nothing stale can leave the app, and the drawer stays a YAML preview. */
    return (
      <div ref={splitContainerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {error && (
          <div style={{ padding: '12px 16px 0' }}>
            {renderGenerationNotice(Boolean(installContent || agentContent), error, stale)}
          </div>
        )}
        {/* Install config pane */}
        <div data-artifact="install-config.yaml" style={{ flex: splitRatio, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>install-config.yaml</h3>
              <button
                type="button"
                className="ghost small"
                onClick={() => downloadFile(installContent, 'install-config.yaml')}
                disabled={!installContent || !!installError || loading}
              >
                Download
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {installOwnError && renderGenerationNotice(Boolean(installContent), installOwnError, true)}
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
        <div data-artifact="agent-config.yaml" style={{ flex: 1 - splitRatio, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>agent-config.yaml</h3>
              <button
                type="button"
                className="ghost small"
                onClick={() => downloadFile(agentContent, 'agent-config.yaml')}
                disabled={!agentContent || !!agentError || loading}
              >
                Download
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {agentOwnError && renderGenerationNotice(Boolean(agentContent), agentOwnError, true)}
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
    const paneError = errorFor('imageset-config.yaml');
    const paneStale = staleFor('imageset-config.yaml');

    // NOTE: useMemo removed to fix React Hooks violation
    // Highlighting is now done inline without memoization
    const highlightedHtml = displayContent ? Prism.highlight(displayContent, Prism.languages.yaml, 'yaml') : '';

    // TODO: When uploaded ImageSet config is stored in state, prioritize it over generated
    // Check state.ocMirror?.uploadedImageSetConfig or similar field
    const source = 'Generated'; // Will be 'Uploaded' when user provides their own

    return (
      <div className="yaml-config-pane" data-artifact="imageset-config.yaml" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
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
            disabled={!content || !!paneError || loading}
          >
            Download
          </button>
        </div>
        {renderGenerationNotice(Boolean(content), paneError, paneStale)}
        {loading && !content && <p className="subtle">Generating...</p>}
        {content && (
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
        {!loading && !paneError && !content && (
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
