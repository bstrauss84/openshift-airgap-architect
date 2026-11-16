/**
 * OpenShift Airgap Architect - Mirroring platform release (v2.2.0 M2)
 *
 * The shared release selector (useOpenShiftRelease + ReleaseSelector) bound to
 * ONE Mirroring profile. The adapter writes only this profile's
 * `platform.release` / `platform.version`, through the server-owned profile
 * API; there is no Install state, no operator invalidation and no Blueprint
 * lock anywhere on this path. Locking is explicit and per profile.
 *
 * Edits are kept in a local draft and saved with a short debounce (one request
 * for the several writes a single selection produces), flushed before a lock
 * and on unmount. The server re-validates every write (422 for an unsupported
 * minor, 409 for a change to a locked release).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import ReleaseSelector from "../components/ReleaseSelector.jsx";
import { useOpenShiftRelease } from "../hooks/useOpenShiftRelease.js";
import { getOpenShiftMinorFromSources } from "../shared/openShiftMinor.js";
import { SUPPORTED_MINORS, getNewestSupportedMinor } from "../shared/versionPolicy.js";
import { updateProfile, lockProfileRelease, unlockProfileRelease } from "./mirroringApi.js";
import { RELEASE_LOCK_NOTE } from "./mirroringCopy.js";

const SAVE_DEBOUNCE_MS = 400;

const draftFromProfile = (profile) => ({
  release: { ...profile.platform.release },
  version: { ...profile.platform.version }
});

/** Only selection fields are sent; lock state changes only through lock/unlock. */
const releaseWriteBody = (draft) => ({
  platform: {
    release: { channel: draft.release.channel ?? null, patchVersion: draft.release.patchVersion ?? null },
    version: {
      selectedMinor: draft.version.selectedMinor ?? null,
      selectedPatch: draft.version.selectedPatch ?? null,
      selectedChannel: draft.version.selectedChannel ?? null,
      selectedVersion: draft.version.selectedVersion ?? null,
      ...(Number.isFinite(draft.version.selectionTimestamp) ? { selectionTimestamp: draft.version.selectionTimestamp } : {})
    }
  }
});

/** Hosts the hook only for a supported (or not yet chosen) minor. */
const PlatformReleaseSection = ({ profile, onProfileChanged }) => {
  const minor = getOpenShiftMinorFromSources(profile.platform.release, profile.platform.version);
  if (minor && !SUPPORTED_MINORS.includes(minor)) {
    return <UnsupportedPlatformMinor profile={profile} minor={minor} onProfileChanged={onProfileChanged} />;
  }
  return <SupportedPlatformRelease key={profile.id} profile={profile} onProfileChanged={onProfileChanged} />;
};

/**
 * No Fallback: an unsupported minor is never silently replaced. The server
 * refuses to store one, so this is defensive, but if it ever appears the
 * selector is not mounted and the user is offered an explicit switch.
 */
const UnsupportedPlatformMinor = ({ profile, minor, onProfileChanged }) => {
  const newest = getNewestSupportedMinor();
  const [error, setError] = useState("");
  const switchMinor = async () => {
    setError("");
    try {
      if (profile.platform.version.locked) await unlockProfileRelease(profile.id);
      const updated = await updateProfile(profile.id, {
        platform: {
          release: { channel: newest, patchVersion: null },
          version: { selectedMinor: newest, selectedPatch: null, selectedChannel: `stable-${newest}`, selectedVersion: null }
        }
      });
      onProfileChanged(updated);
    } catch (e) {
      setError(e.message || String(e));
    }
  };
  return (
    <section className="card" role="alert">
      <h3>OpenShift release</h3>
      <p>
        This profile names OpenShift <strong>{minor}</strong>, which this version of OpenShift Airgap Architect does not support.
        Supported versions: {SUPPORTED_MINORS.join(", ")}.
      </p>
      <div className="actions">
        <Button variant="primary" onClick={switchMinor}>Switch to {newest}</Button>
      </div>
      {error ? <Banner variant="error">{error}</Banner> : null}
    </section>
  );
};

const SupportedPlatformRelease = ({ profile, onProfileChanged }) => {
  const locked = Boolean(profile.platform.version.locked);
  const [draft, setDraft] = useState(() => draftFromProfile(profile));
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const draftRef = useRef(draft);
  const timerRef = useRef(null);
  const dirtyRef = useRef(false);

  // First hook with effects in this component (see useOpenShiftRelease): its
  // mount/abort effect must precede the effects below. `writeDraft` is
  // defined further down and only called after this render has completed.
  const selection = useOpenShiftRelease({
    release: draft.release,
    version: draft.version,
    locked,
    writeRelease: (nextRelease) => writeDraft((d) => ({ ...d, release: nextRelease })),
    writeVersion: (nextVersion) => writeDraft((d) => ({ ...d, version: { ...d.version, ...nextVersion } }))
  });

  // A lock or unlock answered by the server is the one moment the stored
  // release replaces the draft; ordinary saves echo what the draft already holds.
  useEffect(() => {
    const next = draftFromProfile(profile);
    draftRef.current = next;
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, locked]);

  const save = useCallback(async () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!dirtyRef.current) return null;
    dirtyRef.current = false;
    try {
      const updated = await updateProfile(profile.id, releaseWriteBody(draftRef.current));
      setSaveError("");
      onProfileChanged(updated);
      return updated;
    } catch (e) {
      setSaveError(e.message || String(e));
      return null;
    }
  }, [profile.id, onProfileChanged]);

  const schedule = () => {
    dirtyRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  // Flush a pending selection if the section unmounts (profile switch, Home).
  useEffect(() => () => {
    if (dirtyRef.current) {
      clearTimeout(timerRef.current);
      updateProfile(profile.id, releaseWriteBody(draftRef.current)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const writeDraft = (updater) => {
    const next = updater(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    schedule();
  };

  const lock = async () => {
    setBusy(true);
    setSaveError("");
    try {
      await save();
      const updated = await lockProfileRelease(profile.id);
      onProfileChanged(updated);
    } catch (e) {
      setSaveError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setBusy(true);
    setSaveError("");
    try {
      const updated = await unlockProfileRelease(profile.id);
      onProfileChanged(updated);
    } catch (e) {
      setSaveError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const canLock = Boolean(draft.release.channel && draft.release.patchVersion);

  return (
    <>
      {saveError ? <Banner variant="error">Could not save the release for this profile: {saveError}</Banner> : null}
      <ReleaseSelector
        selection={selection}
        release={draft.release}
        idPrefix="mirroring"
        title="OpenShift platform release"
        headerActions={locked ? (
          <Button id={`mirroring-lock-${profile.id}`} variant="secondary" onClick={unlock} disabled={busy}>Unlock release</Button>
        ) : (
          <Button id={`mirroring-lock-${profile.id}`} variant="primary" onClick={lock} disabled={busy || !canLock}>Lock release</Button>
        )}
        footer={(
          <p className="note note-prominent" role="status">
            {locked
              ? `Release ${draft.release.patchVersion} is locked for this profile. Refreshed Update Service data never changes it; unlock it to choose another.`
              : "Lock the release once it is the payload you intend to mirror. Each profile has its own lock; the Install workflow's release is separate and is not affected."}
            {" "}{RELEASE_LOCK_NOTE}
          </p>
        )}
      />
    </>
  );
};

export default PlatformReleaseSection;
