/**
 * OpenShift Airgap Architect - Field Guide Template Renderer
 *
 * Simple {{varName}} interpolation for field guide markdown templates.
 * Unknown variables are left as-is so the output makes missing context visible.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
const render = (text, ctx) => {
  if (!text) return "";
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = ctx[key];
    return val !== undefined && val !== null && val !== "" ? String(val) : match;
  });
};

export { render };
