import { useState, useRef, useEffect, useCallback } from "react";
import { getDeterministicProgress } from "./catalogScanProgress.js";

const CATALOG_IDS = ["redhat", "certified", "community"];
const TICK_MS = 250;

/**
 * Reusable hook for deterministic scan progress (0→95 over 6 min, 100 on complete).
 * One logical controller; multiple catalogs keyed by id.
 * @returns {{ displayProgress: Record<string, number | null>, start: (id: string) => void, complete: (id: string) => void, fail: (id: string) => void }}
 */
export function useCatalogScanProgress() {
  const [displayProgress, setDisplayProgress] = useState(() =>
    Object.fromEntries(CATALOG_IDS.map((id) => [id, null]))
  );
  const startTimesRef = useRef(Object.fromEntries(CATALOG_IDS.map((id) => [id, null])));
  const intervalRef = useRef(null);

  const start = useCallback((catalogId, startedAtMs = null) => {
    if (!CATALOG_IDS.includes(catalogId)) return;
    const t = startedAtMs != null && startedAtMs > 0 ? startedAtMs : Date.now();
    startTimesRef.current[catalogId] = t;
    setDisplayProgress((prev) => ({ ...prev, [catalogId]: getDeterministicProgress(Date.now() - t) }));
  }, []);

  const complete = useCallback((catalogId) => {
    if (!CATALOG_IDS.includes(catalogId)) return;
    startTimesRef.current[catalogId] = null;
    setDisplayProgress((prev) => ({ ...prev, [catalogId]: 100 }));
  }, []);

  const fail = useCallback((catalogId) => {
    if (!CATALOG_IDS.includes(catalogId)) return;
    startTimesRef.current[catalogId] = null;
    setDisplayProgress((prev) => ({ ...prev, [catalogId]: null }));
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const next = {};
      let changed = false;
      for (const id of CATALOG_IDS) {
        const startTime = startTimesRef.current[id];
        if (startTime != null) {
          const elapsed = Date.now() - startTime;
          next[id] = getDeterministicProgress(elapsed);
          changed = true;
        }
      }
      if (changed) {
        setDisplayProgress((prev) => ({ ...prev, ...next }));
      }
    }, TICK_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, []);

  return { displayProgress, start, complete, fail };
}
