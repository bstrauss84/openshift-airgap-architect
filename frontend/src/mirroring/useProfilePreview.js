/**
 * OpenShift Airgap Architect - Mirroring profile ImageSetConfiguration preview
 * (v2.2.0 M3)
 *
 * Fetches POST /api/mirroring/profiles/:id/preview — the same generator Install
 * uses, with the profile's content groups — whenever the open profile changes.
 *
 *  - Superseded requests are ignored (profile switch, rapid edits).
 *  - A profile that is not ready yet returns the server's own reasons; they are
 *    shown instead of any YAML. Nothing is fabricated or carried over from
 *    another profile.
 *  - After a generation error the previous YAML is dropped, not shown as
 *    current.
 *  - Download fetches the configuration again, so the file written is exactly
 *    what the server generates at that moment (an ImageSetConfiguration holds
 *    no credentials, so the export and preview bytes are the same document).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api.js";

const DEBOUNCE_MS = 250;
const previewUrl = (id) => `/api/mirroring/profiles/${encodeURIComponent(id)}/preview`;
const draftUrl = (id) => `/api/mirroring/profiles/${encodeURIComponent(id)}/preview-draft`;

export function useProfilePreview(profile) {
  const [yaml, setYaml] = useState("");
  const [content, setContent] = useState(null);
  const [validation, setValidation] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [notReady, setNotReady] = useState([]);
  // R-UX09: what the current selection renders to while the profile is not
  // ready — { yaml, blockers, omitted, error } — never downloadable.
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const seqRef = useRef(0);
  const profileIdRef = useRef(null);

  const id = profile?.id || null;
  const version = profile ? profile.updatedAt : null;

  useEffect(() => {
    if (!id) {
      seqRef.current += 1;
      setYaml(""); setContent(null); setWarnings([]); setNotReady([]); setDraft(null); setError(""); setLoading(false); setStale(false);
      profileIdRef.current = null;
      return undefined;
    }
    if (profileIdRef.current !== id) {
      // Another profile: never show the previous profile's YAML, even briefly.
      setYaml(""); setContent(null); setWarnings([]); setNotReady([]); setDraft(null); setError("");
      profileIdRef.current = id;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setStale(true);
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(previewUrl(id), { method: "POST", body: "{}" });
        if (seq !== seqRef.current) return;
        setYaml(data.imagesetConfig || "");
        setContent(data.content || null);
        setValidation(data.validation || null);
        setWarnings(data.warnings || []);
        setNotReady([]);
        setDraft(null);
        setError("");
      } catch (e) {
        if (seq !== seqRef.current) return;
        setYaml("");
        setContent(null);
        setValidation(null);
        if (e?.payload?.code === "PROFILE_NOT_READY") {
          // fetchForDownload below never uses the draft: only the validated route is downloadable.
          setNotReady((e.payload.details || []).map((d) => d.message));
          setError("");
          try {
            const d = await apiFetch(draftUrl(id), { method: "POST", body: "{}" });
            if (seq !== seqRef.current) return;
            setDraft({ yaml: d.imagesetConfig || "", blockers: d.blockers?.length ? d.blockers : (e.payload.details || []), omitted: d.omitted || [], error: d.error || "" });
          } catch (draftError) {
            if (seq !== seqRef.current) return;
            setDraft({ yaml: "", blockers: e.payload.details || [], omitted: [], error: draftError?.message || "" });
          }
        } else {
          setNotReady([]);
          setDraft(null);
          setError(e?.message || "The ImageSetConfiguration could not be generated.");
        }
      } finally {
        if (seq === seqRef.current) {
          setLoading(false);
          setStale(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [id, version]);

  const fetchForDownload = useCallback(async () => {
    if (!id) throw new Error("no profile is open");
    const data = await apiFetch(previewUrl(id), { method: "POST", body: "{}" });
    return data.imagesetConfig || "";
  }, [id]);

  return { yaml, content, validation, warnings, notReady, draft, error, loading, stale, fetchForDownload };
}
