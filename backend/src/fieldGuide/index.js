/**
 * Field Guide entry point.
 * buildFieldGuide(state, docsLinks) → markdown string
 */
import { buildContext } from "./context.js";
import { renderGuide } from "./assembler.js";

const buildFieldGuide = (state, docsLinks) => {
  const ctx = buildContext(state || {});
  return renderGuide(state || {}, ctx, docsLinks || []);
};

export { buildFieldGuide };
