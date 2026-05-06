/**
 * OpenShift Airgap Architect - Field Guide Entry Point
 *
 * buildFieldGuide(state, docsLinks) → markdown string
 * Main entry point for Field Guide generation. Orchestrates context building,
 * compartment selection, and final markdown assembly.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { buildContext } from "./context.js";
import { renderGuide } from "./assembler.js";

const buildFieldGuide = (state, docsLinks) => {
  const ctx = buildContext(state || {});
  return renderGuide(state || {}, ctx, docsLinks || []);
};

export { buildFieldGuide };
