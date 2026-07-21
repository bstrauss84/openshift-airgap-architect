/**
 * Centralized selector constants for E2E tests.
 *
 * The app uses NO data-testid attributes. Selectors rely on CSS classes,
 * aria-labels, placeholder text, and button text.
 */

export const LANDING = {
  installCard: 'button.landing-card-install',
  heading: 'h1',
};

export const FOOTER = {
  proceed: 'footer button.primary',
  back: 'footer button.ghost',
};

export const SIDEBAR = {
  step: (name) => `button.step-item:has-text("${name}")`,
  activeStep: 'button.step-item.active',
  stepList: 'nav.step-list',
};

export const CARDS = {
  card: (text) => `button.select-card:has-text("${text}")`,
  selected: 'button.select-card.selected',
  anyCard: 'button.select-card',
};

export const MODAL = {
  backdrop: '.modal-backdrop',
  modal: '.modal',
  lockTitle: '#core-lock-title',
  lockConfirm: '.modal button.primary',
  lockCancel: '.modal button.ghost',
};

export const SECRET_INPUT = {
  container: '.pull-secret-section-inline',
  textarea: (ariaLabel) => `textarea[aria-label="${ariaLabel}"]`,
  showToggle: 'button.pull-secret-toggle',
  uploadBtn: 'button:has-text("Upload file")',
};

export const SWITCH = {
  byLabel: (label) => `button[role="switch"][aria-label="${label}"]`,
};

export const BLUEPRINT = {
  minorChannel: 'select',
  patchVersion: 'select',
  manualMinor: '[data-testid="blueprint-manual-minor"]',
  manualPatch: '[data-testid="blueprint-manual-patch"]',
  manualApply: '[data-testid="blueprint-manual-apply"]',
};

export const REVIEW = {
  downloadBundle: 'button:has-text("Download Bundle")',
  actionsDropdown: 'button:has-text("Actions")',
  showSensitive: 'button:has-text("Show sensitive values")',
  hideSensitive: 'button:has-text("Hide sensitive values")',
  previewPane: '.preview',
};

export const HOST_INVENTORY = {
  nodeTile: 'button.host-inventory-v2-tile',
  generateNodes: 'button:has-text("Generate nodes")',
  clearNodes: 'button:has-text("Clear and set counts again")',
  drawerClose: 'button[aria-label="Close drawer"]',
  drawerPrev: 'button:has-text("Previous")',
  drawerNext: 'button:has-text("Next")',
};

export const OPERATORS = {
  scenarioPick: (name) => `button.scenario-pick:has-text("${name}")`,
  clearSelections: 'button:has-text("Clear selections")',
  selectedCard: '.selected-card',
};
