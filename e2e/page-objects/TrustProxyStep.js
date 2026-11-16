import { expect } from '@playwright/test';

/**
 * Page object for trust and proxy configuration fields.
 *
 * In the app these fields live inside the GlobalStrategyStep component.
 * This page object encapsulates the proxy toggle, proxy URL fields,
 * CA certificate textareas, and the additionalTrustBundlePolicy select.
 */
export class TrustProxyStep {
  constructor(page) {
    this.page = page;
  }

  // --- Proxy toggle ---
  // The proxy toggle is a checkbox in a .toggle-row, not a role="switch"

  proxyCheckbox() {
    return this.page.locator('.toggle-row input[type="checkbox"]').first();
  }

  async toggleProxy() {
    await this.proxyCheckbox().click();
  }

  // --- HTTP Proxy ---

  httpProxyTextarea() {
    return this.page.locator('textarea[placeholder*="http://proxy.corp"]');
  }

  async fillHttpProxy(url) {
    const textarea = this.httpProxyTextarea();
    await textarea.fill(url);
    await textarea.blur();
  }

  // --- HTTPS Proxy ---

  httpsProxyTextarea() {
    return this.page.locator('textarea[placeholder*="https://proxy.corp"]');
  }

  async fillHttpsProxy(url) {
    const textarea = this.httpsProxyTextarea();
    await textarea.fill(url);
    await textarea.blur();
  }

  // --- No Proxy ---

  noProxyTextarea() {
    return this.page.locator('textarea[placeholder*=".cluster.local"]');
  }

  async fillNoProxy(list) {
    const textarea = this.noProxyTextarea();
    await textarea.fill(list);
    await textarea.blur();
  }

  // --- Mirror CA Certificate ---

  mirrorCaCertTextarea() {
    // There may be two PEM textareas; the first is for the mirror registry CA
    return this.page.locator('textarea[placeholder*="PEM"]').first();
  }

  async fillMirrorCaCert(pem) {
    const textarea = this.mirrorCaCertTextarea();
    await textarea.fill(pem);
    await textarea.blur();
  }

  // --- Proxy CA Certificate ---

  proxyCaCertTextarea() {
    // The second PEM textarea, if visible, is for the proxy CA
    return this.page.locator('textarea[placeholder*="PEM"]').nth(1);
  }

  async fillProxyCaCert(pem) {
    const textarea = this.proxyCaCertTextarea();
    await textarea.fill(pem);
    await textarea.blur();
  }

  // --- Trust Bundle Policy select ---

  trustPolicySelect() {
    return this.page
      .locator('select')
      .filter({ has: this.page.locator('option:has-text("Proxyonly")') });
  }

  async selectTrustPolicy(value) {
    await this.trustPolicySelect().selectOption(value);
  }

  // --- Mirror registry private CA checkbox ---

  mirrorPrivateCaCheckbox() {
    return this.page
      .locator(':has-text("private/self-signed CA") input[type="checkbox"]')
      .first()
      .or(
        this.page.locator('input[type="checkbox"]').filter({
          has: this.page.locator('xpath=ancestor::*[contains(., "self-signed")]'),
        }).first(),
      );
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Global Strategy")');
  }
}
