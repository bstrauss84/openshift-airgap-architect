/**
 * OpenShift Airgap Architect - Feedback API Client
 *
 * Frontend API wrapper for user feedback system.
 * Handles feedback configuration, challenge-response, and submission.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { apiFetch } from "./api.js";

export async function getFeedbackConfig() {
  return apiFetch("/api/feedback/config");
}

export async function getFeedbackChallenge() {
  return apiFetch("/api/feedback/challenge");
}

export async function submitFeedback(payload) {
  return apiFetch("/api/feedback/submit", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
