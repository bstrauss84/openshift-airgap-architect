/**
 * Template Literal Escape Bug Regression Tests
 *
 * Tests for unescaped template literal variable references in code examples.
 *
 * CRITICAL BUG: When bash/shell variables like ${XDG_RUNTIME_DIR} appear in
 * template literal strings (backticks), they MUST be escaped as \${VAR} or
 * JavaScript will try to interpolate them as JS variables, causing
 * "ReferenceError: XDG_RUNTIME_DIR is not defined" at runtime.
 *
 * This test ensures all code example components properly escape shell variables.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppProvider } from '../src/store.jsx';
import App from '../src/App.jsx';

/**
 * Render a step and check if it throws ReferenceError for undefined variables.
 * Shell variables in code examples should NOT cause JavaScript errors.
 */
function renderStepAndCheckForErrors(stepId) {
  const initialState = {
    ui: {
      currentStep: stepId,
      visitedSteps: { [stepId]: true }
    },
    // Minimal state to make step render
    blueprint: {
      platform: 'Bare Metal (UPI)',
      clusterName: 'test-cluster',
      baseDomain: 'example.com'
    },
    methodology: {
      method: 'Agent-based Installer'
    },
    release: {
      channel: 'stable-4.20',
      patchVersion: '4.20.18'
    }
  };

  let caughtError = null;

  try {
    const { container } = render(
      <AppProvider initialState={initialState}>
        <App />
      </AppProvider>
    );
    return { container, error: null };
  } catch (error) {
    caughtError = error;
    return { container: null, error };
  }
}

describe('Template literal escape bugs (shell variables in code examples)', () => {
  it('RunOcMirrorStep should not throw ReferenceError for XDG_RUNTIME_DIR', () => {
    const { error } = renderStepAndCheckForErrors('run-oc-mirror');

    if (error) {
      console.error('Caught error:', error.message);
    }

    // Should NOT have ReferenceError about XDG_RUNTIME_DIR
    expect(error).toBeNull();
  });

  it('IdentityAccessStep should not throw ReferenceError for shell variables', () => {
    const { error } = renderStepAndCheckForErrors('identity-access');

    if (error) {
      console.error('Caught error:', error.message);
    }

    // Should NOT have ReferenceError
    expect(error).toBeNull();
  });

  it('All steps with code examples should render without variable interpolation errors', () => {
    const stepsWithCodeExamples = [
      'identity-access',
      'connectivity-mirroring',
      'trust-proxy',
      'run-oc-mirror'
    ];

    for (const stepId of stepsWithCodeExamples) {
      const { error } = renderStepAndCheckForErrors(stepId);

      if (error) {
        console.error(`Step ${stepId} threw error:`, error.message);
      }

      expect(error, `Step ${stepId} should not throw errors`).toBeNull();
    }
  });
});

/**
 * Documentation test: How to properly escape shell variables in JSX
 */
describe('Template literal escape pattern documentation', () => {
  it('documents the correct escape pattern for shell variables in code blocks', () => {
    // This test documents the pattern - it doesn't execute code

    const incorrectPattern = `
      ❌ WRONG - Will cause ReferenceError:
      const codeExample = \\\`
        cat \${XDG_RUNTIME_DIR}/containers/auth.json
      \\\`;

      JavaScript sees \${XDG_RUNTIME_DIR} and tries to interpolate it as a JS variable.
    `;

    const correctPattern = `
      ✅ CORRECT - Escapes the dollar sign:
      const codeExample = \\\`
        cat \\\${XDG_RUNTIME_DIR}/containers/auth.json
      \\\`;

      The backslash escapes the \$, so output is literal: \${XDG_RUNTIME_DIR}
    `;

    expect(incorrectPattern).toContain('❌');
    expect(correctPattern).toContain('✅');
  });

  it('lists common shell variables that need escaping in code examples', () => {
    const shellVariablesThatNeedEscaping = [
      'XDG_RUNTIME_DIR',  // Podman/container runtime directory
      'HOME',              // User home directory
      'PATH',              // System PATH
      'USER',              // Current user
      'PWD',               // Present working directory
      'SHELL',             // Current shell
      'HOSTNAME',          // System hostname
      'EDITOR',            // Default editor
      'TMPDIR',            // Temporary directory
      'KUBECONFIG'         // Kubernetes config path
    ];

    // In JSX template literals showing bash commands, ALL of these need \$ escaping
    expect(shellVariablesThatNeedEscaping).toHaveLength(10);
  });
});

/**
 * Where this bug was found:
 *
 * frontend/src/steps/RunOcMirrorStep.jsx:1067 - FIXED: \${XDG_RUNTIME_DIR}
 * frontend/src/steps/RunOcMirrorStep.jsx:1139 - FIXED: \${XDG_RUNTIME_DIR}
 *
 * Correct example (for reference):
 * frontend/src/steps/IdentityAccessStep.jsx:544 - Already correct
 *
 * Related bugs to watch for:
 * - Any template literal (backticks) containing bash/shell commands
 * - Variables starting with $ in code examples
 * - Especially environment variables in ALL_CAPS
 */
