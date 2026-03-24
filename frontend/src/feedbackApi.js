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
