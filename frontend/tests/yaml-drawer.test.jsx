/**
 * Tests for YAML Drawer component - Core functionality.
 * Focuses on essential features: drawer rendering, config switching, and security.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import YamlDrawer from '../src/components/YamlDrawer.jsx';

describe('YamlDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    previewFiles: {
      'install-config.yaml': `apiVersion: v1
metadata:
  name: test-cluster
baseDomain: example.com`,
      'agent-config.yaml': `apiVersion: v1
metadata:
  name: agent-config`
    },
    activeStepId: 'identity-access',
    scenario: {
      isAgentBased: false,
      platform: 'AWS',
      method: 'IPI'
    },
    showIncompleteWarning: false,
    loading: false,
    error: ''
  };

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders drawer dialog when isOpen is true', () => {
    render(<YamlDrawer {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders YAML Preview title', () => {
    render(<YamlDrawer {...defaultProps} />);
    expect(screen.getByText('YAML Preview')).toBeInTheDocument();
  });

  it('renders install-config.yaml for non-agent scenarios', () => {
    render(<YamlDrawer {...defaultProps} />);
    expect(screen.getByText('install-config.yaml')).toBeInTheDocument();
  });

  it('renders both configs in agent-based scenarios', () => {
    const agentScenario = {
      isAgentBased: true,
      platform: 'Bare Metal',
      method: 'Agent-Based Installer'
    };
    render(<YamlDrawer {...defaultProps} scenario={agentScenario} />);

    expect(screen.getByText('install-config.yaml')).toBeInTheDocument();
    expect(screen.getByText('agent-config.yaml')).toBeInTheDocument();
  });

  it('shows imageset-config on Operators tab', () => {
    const imageSetFiles = {
      'imageset-config.yaml': `apiVersion: mirror.openshift.io/v1alpha2`
    };
    render(<YamlDrawer {...defaultProps} activeStepId="operators" previewFiles={imageSetFiles} />);

    expect(screen.getByText('imageset-config.yaml')).toBeInTheDocument();
  });

  it('shows imageset-config with Generated badge on Run oc-mirror tab', () => {
    const imageSetFiles = {
      'imageset-config.yaml': `apiVersion: mirror.openshift.io/v1alpha2`
    };
    render(<YamlDrawer {...defaultProps} activeStepId="run-oc-mirror" previewFiles={imageSetFiles} />);

    expect(screen.getByText('imageset-config.yaml')).toBeInTheDocument();
    expect(screen.getByText('Generated')).toBeInTheDocument();
  });

  it('shows sensitive values toggle', () => {
    render(<YamlDrawer {...defaultProps} />);
    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeInTheDocument();
    expect(screen.getByText(/show sensitive values/i)).toBeInTheDocument();
  });

  it('shows close button', () => {
    render(<YamlDrawer {...defaultProps} />);
    expect(screen.getByLabelText('Close YAML Preview')).toBeInTheDocument();
  });

  it('shows loading state when loading', () => {
    render(<YamlDrawer {...defaultProps} loading={true} />);
    expect(screen.getByText('Generating...')).toBeInTheDocument();
  });

  it('shows error when error is provided', () => {
    render(<YamlDrawer {...defaultProps} error="Test error message" />);
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('shows incomplete warning when showIncompleteWarning is true', () => {
    render(<YamlDrawer {...defaultProps} showIncompleteWarning={true} />);
    expect(screen.getByText(/incomplete configuration/i)).toBeInTheDocument();
  });

  it('has proper ARIA attributes', () => {
    render(<YamlDrawer {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'yaml-drawer-title');
  });

  it('shows helpful message when ImageSet is missing on Run oc-mirror tab', () => {
    render(<YamlDrawer {...defaultProps} activeStepId="run-oc-mirror" previewFiles={{}} />);
    expect(screen.getByText(/no imageset configuration available yet/i)).toBeInTheDocument();
  });
});
