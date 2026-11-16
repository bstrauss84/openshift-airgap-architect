/**
 * OpenShift Airgap Architect - shared OpenShift release selection (v2.2.0 M2)
 *
 * The channel / patch / Cincinnati-refresh / manual-release logic that used to
 * live inside BlueprintStep, extracted so the Install Blueprint and a Mirroring
 * profile drive ONE implementation instead of two. The behaviour is moved
 * verbatim; the only change is where writes go.
 *
 * WRITES GO THROUGH AN ADAPTER. The hook never touches the app store directly:
 *
 *   writeRelease(nextRelease, { manual })  — the workflow's `release` object
 *   writeVersion(nextVersion)              — the workflow's v3 `version` object
 *   onRefreshJobFailed(jobId)              — optional; Install highlights the job
 *
 * Install's adapter reproduces its previous writes exactly, including the
 * install-domain side effect `operators.stale = true` that the old
 * `updateVersionSelection` hard-coded. A Mirroring profile passes an adapter
 * that writes only that profile, so no Install state, operator invalidation or
 * Blueprint lock is reachable from Mirroring.
 *
 * Lock semantics are the caller's: `locked` freezes every selection path here
 * (channel, patch, manual apply, Update) exactly as `getVersionLocked(state)`
 * did for Blueprint. Refreshed Cincinnati data never changes a locked release.
 *
 * Supported-minor enforcement is unchanged: channels pass through
 * `classifyChannels`, so an unsupported minor is never offered, and newer
 * upstream minors are reported, never selected.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api.js";
import { validateManualOpenShiftRelease } from "../validation.js";
import { sortChannelsBySemverDescending, getNewestSupportedChannel, classifyChannels } from "../shared/cincinnatiChannels.js";
import { parseMinorVersionCore } from "../shared/openShiftMinor.js";

const JOB_TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * Poll a job until it reaches a terminal status.
 *
 * `signal` is REQUIRED to be honoured, not optional politeness: without it the
 * loop ran for up to `timeoutMs` (two minutes) after the step was unmounted,
 * calling `/api/jobs/<id>` every 400 ms and then writing to the shared app
 * store from a component that no longer exists. Navigating away from Blueprint
 * unmounts the step but NOT `AppProvider`, so those writes landed in live
 * state.
 *
 * The check is at the top of each iteration AND the signal is handed to
 * `apiFetch` (which spreads `options` into `fetch`), so an abort both cancels
 * the in-flight request and stops the next one from being issued.
 */
export async function pollJobUntilTerminal(jobId, { timeoutMs = 120000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("Cincinnati refresh polling cancelled.", "AbortError");
    const job = await apiFetch(`/api/jobs/${jobId}`, { signal });
    if (JOB_TERMINAL.has(job.status)) return job;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out waiting for Cincinnati refresh job.");
}

export function useOpenShiftRelease({ release, version: versionInput, locked: releaseLocked, writeRelease, writeVersion, onRefreshJobFailed }) {
  const version = versionInput || {};

  const [channels, setChannels] = useState([]);
  const [newerUnsupportedChannels, setNewerUnsupportedChannels] = useState([]);
  const [patches, setPatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [patchesLoading, setPatchesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("");
  const [updatedMessage, setUpdatedMessage] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualMinor, setManualMinor] = useState("");
  const [manualPatch, setManualPatch] = useState("");
  const [manualApplyError, setManualApplyError] = useState("");
  /** Suppress automatic patch fetch for N `release.channel` effect runs (forced refresh + StrictMode). */
  const channelPatchAutoFetchSuppressRef = useRef(0);
  const prevAdvancedOpenRef = useRef(false);
  const patchFetchGenerationRef = useRef(0);
  /**
   * Unmount guard.
   *
   * Every async path here (`refresh`, `fetchPatches`, the mount effects)
   * resumes after an `await` and then writes component state and/or the
   * workflow's store through the adapter. That store OUTLIVES the component —
   * navigating away unmounts only the step — so an unguarded resume is not a
   * harmless React no-op: it mutates live application state and triggers a
   * persistence write. `mountedRef` gates those resumes; `abortRef` cancels the
   * requests themselves. Both are returned so the host component can guard its
   * own async work with the same lifecycle.
   */
  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  /** Handle of the 5 s "Channels updated." banner timer, so it can be cleared. */
  const updatedMessageTimerRef = useRef(null);

  // MUST be the first effect: React runs effects, and their cleanups, in
  // declaration order, so this is what guarantees `abortRef` is populated
  // before any later effect reads it and aborted before any later cleanup
  // runs. Call this hook before the host component declares its own effects.
  // `mountedRef` is re-armed on mount rather than only cleared on unmount,
  // because StrictMode (src/main.jsx) mounts, unmounts and remounts.
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    return () => {
      mountedRef.current = false;
      controller.abort();
      clearTimeout(updatedMessageTimerRef.current);
      updatedMessageTimerRef.current = null;
    };
  }, []);

  /** Show the transient "Channels updated." banner, replacing any pending hide. */
  const showUpdatedMessage = () => {
    if (!mountedRef.current) return;
    setUpdatedMessage(true);
    clearTimeout(updatedMessageTimerRef.current);
    updatedMessageTimerRef.current = setTimeout(() => setUpdatedMessage(false), 5000);
  };

  const updateVersionSelection = (patch) => {
    const channel = patch.selectedChannel ?? version.selectedChannel ?? (release?.channel ? `stable-${release.channel}` : null);
    const channelMinor = channel ? parseMinorVersionCore(channel.replace(/^stable-/i, "")) : null;
    const patchVersion = patch.selectedVersion !== undefined ? patch.selectedVersion : (version.selectedVersion ?? release?.patchVersion);
    writeVersion({
      selectedChannel: version.selectedChannel ?? (release?.channel ? `stable-${release.channel}` : null),
      selectedVersion: version.selectedVersion ?? release?.patchVersion,
      selectionTimestamp: version.selectionTimestamp ?? Date.now(),
      confirmedByUser: false,
      confirmationTimestamp: null,
      locked: false,
      ...patch,
      selectedMinor: channelMinor || null,
      selectedPatch: patchVersion || null,
    });
  };

  useEffect(() => {
    const signal = abortRef.current?.signal;
    setLoading(true);
    apiFetch("/api/cincinnati/channels", { signal })
      .then((data) => {
        // Resumed after an await. Everything below writes component state or
        // the workflow's store, so a dead component must write nothing. This
        // suppresses post-unmount writes only: while mounted the branch logic
        // — including the No-Fallback behaviour, which never synthesises or
        // clears a selection on a failed load — is unchanged.
        if (!mountedRef.current) return;
        const { supported, newerUnsupported } = classifyChannels(data.channels || []);
        setChannels(sortChannelsBySemverDescending(supported));
        setNewerUnsupportedChannels(sortChannelsBySemverDescending(newerUnsupported));

        if (!supported.length && !releaseLocked) {
          writeRelease({ ...release, channel: null, patchVersion: null, confirmed: false, followLatestMinor: true });
          updateVersionSelection({ selectedChannel: null, selectedVersion: null, selectionTimestamp: Date.now() });
        }
        if (!releaseLocked && !release?.channel && supported.length) {
          const channel = getNewestSupportedChannel(data.channels);
          if (channel) {
            writeRelease({ ...release, channel, followLatestMinor: true, confirmed: false });
            updateVersionSelection({ selectedChannel: `stable-${channel}`, selectedVersion: null, selectionTimestamp: Date.now() });
          }
        }
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setLoading(false);
        apiFetch("/api/cincinnati/update", { method: "POST", signal })
          .then((data) => {
            if (!mountedRef.current) return;
            if (data.channels?.length) {
              const { supported, newerUnsupported } = classifyChannels(data.channels);
              setChannels(sortChannelsBySemverDescending(supported));
              setNewerUnsupportedChannels(sortChannelsBySemverDescending(newerUnsupported));
            }
          })
          .catch(() => {});
      })
      // apiFetch rejects on a network failure and on any non-2xx, and
      // `.finally` re-raises whatever it was handed, so the initial channel
      // load produced an unhandled rejection whenever the backend was
      // unreachable. Behaviour is otherwise unchanged and deliberately so:
      // `loading` is already cleared in the `.finally` above, `channels`
      // stays empty, and a previously selected channel is left untouched —
      // no fallback to an unverified version.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load, as before the extraction
  }, []);

  const fetchPatches = async (channel, force = false) => {
    if (!channel) return;
    if (force && channel !== release?.channel) {
      channelPatchAutoFetchSuppressRef.current = 1;
    }
    const gen = ++patchFetchGenerationRef.current;
    setPatchesLoading(true);
    setPatches([]);
    const endpoint = force ? "/api/cincinnati/patches/update" : "/api/cincinnati/patches";
    const signal = abortRef.current?.signal;
    try {
      const data = force
        ? await apiFetch(endpoint, { method: "POST", body: JSON.stringify({ channel }), signal })
        : await apiFetch(`${endpoint}?channel=${encodeURIComponent(channel)}`, { signal });
      if (!mountedRef.current) return;
      if (gen !== patchFetchGenerationRef.current) return;
      setPatches(data.versions || []);
      if (releaseLocked) {
        return;
      }
      if (data.versions?.length) {
        const patchVersion = data.versions[0];
        writeRelease({ ...release, channel, patchVersion, confirmed: false });
        updateVersionSelection({
          selectedChannel: `stable-${channel}`,
          selectedVersion: patchVersion,
          selectionTimestamp: Date.now()
        });
      } else {
        writeRelease({ ...release, channel, patchVersion: null, confirmed: false });
        updateVersionSelection({
          selectedChannel: `stable-${channel}`,
          selectedVersion: null,
          selectionTimestamp: Date.now()
        });
      }
    } finally {
      if (mountedRef.current) setPatchesLoading(false);
    }
  };

  useEffect(() => {
    if (!release?.channel) return;
    if (channelPatchAutoFetchSuppressRef.current > 0) {
      channelPatchAutoFetchSuppressRef.current -= 1;
      return;
    }
    fetchPatches(release.channel).catch(() => {
      if (mountedRef.current) setPatchesLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the channel only, as before the extraction
  }, [release?.channel]);

  useEffect(() => {
    const wasOpen = prevAdvancedOpenRef.current;
    if (advancedOpen && !wasOpen) {
      setManualMinor(String(release?.channel ?? ""));
      setManualPatch(String(release?.patchVersion ?? ""));
    }
    prevAdvancedOpenRef.current = advancedOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed when the panel opens; release is read from the render that opened it.
  }, [advancedOpen]);

  const updateChannel = (channel) => {
    if (releaseLocked) return;
    // User explicitly changed minor: drop stale patch list / in-flight fetches from manual entry or prior channel.
    channelPatchAutoFetchSuppressRef.current = 0;
    patchFetchGenerationRef.current += 1;
    setPatches([]);
    setPatchesLoading(true);
    writeRelease({ ...release, channel, patchVersion: null, confirmed: false, followLatestMinor: false });
    updateVersionSelection({ selectedChannel: `stable-${channel}`, selectedVersion: null, selectionTimestamp: Date.now() });
  };

  const updatePatch = (patchVersion) => {
    if (releaseLocked) return;
    writeRelease({ ...release, patchVersion, confirmed: false });
    updateVersionSelection({ selectedChannel: `stable-${release.channel}`, selectedVersion: patchVersion, selectionTimestamp: Date.now() });
  };

  const refresh = async () => {
    const signal = abortRef.current?.signal;
    setRefreshing(true);
    setRefreshError("");
    setRefreshNote("Queuing Cincinnati refresh…");
    try {
      const { jobId } = await apiFetch("/api/cincinnati/refresh-job", {
        method: "POST",
        body: JSON.stringify({ preferredChannel: release?.channel || null }),
        signal
      });
      if (!mountedRef.current) return;
      setRefreshNote("Refresh running—Operations shows live progress…");
      const job = await pollJobUntilTerminal(jobId, { signal });
      if (!mountedRef.current) return;
      if (job.status !== "completed") {
        const outLines = job.output ? String(job.output).trim().split("\n").filter(Boolean) : [];
        const msg =
          (job.message && String(job.message).trim()) ||
          outLines[outLines.length - 1] ||
          "Cincinnati refresh failed.";
        setRefreshError(String(msg));
        if (onRefreshJobFailed) onRefreshJobFailed(jobId);
        return;
      }
      const chRes = await apiFetch("/api/cincinnati/channels", { signal });
      if (!mountedRef.current) return;
      const { supported, newerUnsupported } = classifyChannels(chRes.channels || []);
      const newChannels = sortChannelsBySemverDescending(supported);
      setChannels(newChannels);
      setNewerUnsupportedChannels(sortChannelsBySemverDescending(newerUnsupported));

      if (newChannels.length === 0) {
        showUpdatedMessage();
        return;
      }
      const newestChannel = getNewestSupportedChannel(chRes.channels);
      const followLatest = release?.followLatestMinor === true;
      let channelToLoad;
      if (releaseLocked) {
        channelToLoad = release?.channel || newestChannel;
      } else if (followLatest) {
        channelToLoad = newestChannel;
      } else {
        const cur = release?.channel;
        channelToLoad = cur && newChannels.includes(cur) ? cur : newestChannel;
      }
      await fetchPatches(channelToLoad, false);
      if (!mountedRef.current) return;
      showUpdatedMessage();
    } catch (e) {
      if (!mountedRef.current) return;
      setPatchesLoading(false);
      setRefreshError(e?.message || String(e));
    } finally {
      // Reached by the early `return`s above as well, so it needs its own guard.
      if (mountedRef.current) {
        setRefreshNote("");
        setRefreshing(false);
      }
    }
  };

  const applyManualRelease = () => {
    setManualApplyError("");
    const r = validateManualOpenShiftRelease(manualMinor, manualPatch);
    if (!r.ok) {
      setManualApplyError(r.errors[0]);
      return;
    }
    const minor = manualMinor.trim();
    const patch = manualPatch.trim();
    if (minor !== (release?.channel || "")) {
      channelPatchAutoFetchSuppressRef.current = 2;
      patchFetchGenerationRef.current += 1;
    }
    writeRelease({ ...release, channel: minor, patchVersion: patch, confirmed: false, followLatestMinor: false }, { manual: true });
    updateVersionSelection({
      selectedChannel: `stable-${minor}`,
      selectedVersion: patch,
      selectionTimestamp: Date.now()
    });
    setPatches([patch]);
    setRefreshError("");
  };

  return {
    channels,
    newerUnsupportedChannels,
    patches,
    loading,
    patchesLoading,
    refreshing,
    refreshNote,
    updatedMessage,
    refreshError,
    manualMinor,
    setManualMinor,
    manualPatch,
    setManualPatch,
    manualApplyError,
    setAdvancedOpen,
    updateChannel,
    updatePatch,
    refresh,
    applyManualRelease,
    locked: Boolean(releaseLocked),
    mountedRef,
    abortRef
  };
}
