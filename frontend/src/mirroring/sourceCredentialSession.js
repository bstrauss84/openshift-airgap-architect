/**
 * OpenShift Airgap Architect - one transient Red Hat source credential per
 * Mirroring profile (v2.2.0, R-UX02)
 *
 * Entered once (for example for Scan catalogs), it can be used again for the
 * Live catalog check, preflight and runs of the SAME profile without pasting it
 * again — but only after the user says so at each place ("Use it here").
 *
 * Lifetime contract:
 *  - JavaScript memory of this page only: a module-level Map. Never written to
 *    the profile, the server's state, URLs, localStorage, sessionStorage, a
 *    service worker, job metadata or logs. Each request still sends it, and the
 *    server keeps it in a temporary file for that request only.
 *  - Keyed by profile id: never shared with another profile, never used as a
 *    destination (mirror registry) credential.
 *  - Gone on reload, when the page closes, when the profile is deleted, or on
 *    Forget. Replace swaps it everywhere for that profile.
 *  - The mounted pull secret is the same kind of choice: explicit, per profile,
 *    and only where the user accepted it.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { useEffect, useState } from "react";

/** profileId -> { secret: string, mounted: boolean, enteredFor: site, approved: Set<site> } */
const sessions = new Map();
const listeners = new Set();
const notify = () => { for (const l of listeners) l(); };

/** What each place calls the credential's origin, in words. */
export const SITE_LABEL = {
  scan: "the catalog scan",
  check: "the Live catalog check",
  run: "this run",
  retry: "a retried run"
};

export const getSourceCredential = (profileId) => (profileId ? sessions.get(profileId) || null : null);

/** Enter or replace the profile's source credential at `site` (it is then accepted there only). */
export function setSourceCredential(profileId, { secret = "", mounted = false }, site) {
  if (!profileId) return;
  if (!mounted && !String(secret).trim()) { forgetSourceCredential(profileId); return; }
  sessions.set(profileId, { secret: mounted ? "" : String(secret).trim(), mounted: Boolean(mounted), enteredFor: site, approved: new Set([site]) });
  notify();
}

/** The user accepts the profile's existing credential at `site`. */
export function approveSourceCredential(profileId, site) {
  const entry = sessions.get(profileId);
  if (!entry) return;
  sessions.set(profileId, { ...entry, approved: new Set([...entry.approved, site]) });
  notify();
}

export function forgetSourceCredential(profileId) {
  if (sessions.delete(profileId)) notify();
}

/** Tests only: what a page reload does. */
export const _resetSourceCredentialsForTests = () => { sessions.clear(); notify(); };

/**
 * The profile's credential as one place (`site`) may use it.
 * `body` is what a request sends: the mounted choice, the pasted secret, or
 * nothing (inline without a secret) when it has not been accepted here.
 */
export function useSourceCredential(profileId, site) {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  const entry = getSourceCredential(profileId);
  const usable = Boolean(entry && entry.approved.has(site));
  return {
    entry,
    usable,
    offerReuse: Boolean(entry && !usable),
    mounted: usable && entry.mounted,
    secret: usable && !entry.mounted ? entry.secret : "",
    body: usable ? (entry.mounted ? { rhAuthSource: "mounted" } : { rhAuthSource: "inline", rhPullSecret: entry.secret }) : { rhAuthSource: "inline" },
    set: (value) => setSourceCredential(profileId, value, site),
    approve: () => approveSourceCredential(profileId, site),
    forget: () => forgetSourceCredential(profileId)
  };
}
