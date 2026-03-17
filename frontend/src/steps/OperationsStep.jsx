import React, { useEffect, useState, useRef } from "react";
import { useApp } from "../store.jsx";
import { apiFetch, API_BASE } from "../api.js";

const formatJobTime = (createdAt) => {
  if (!createdAt) return "";
  const d = new Date(Number(createdAt));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

const JOB_TYPE_LABELS = {
  "operator-scan": "Operator scan",
  "docs-update": "Docs update",
  "oc-mirror-run": "oc-mirror run"
};

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

const OperationsStep = () => {
  useApp(); // app context available for future (e.g. filter by run)
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [streamingJob, setStreamingJob] = useState(null);
  const [streamEnded, setStreamEnded] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const logPreRef = useRef(null);
  const eventSourceRef = useRef(null);

  const loadJobs = async () => {
    try {
      const data = await apiFetch("/api/jobs");
      setJobs(data.jobs || []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  // When a job is selected, fetch its latest snapshot immediately so logs show without waiting for SSE
  useEffect(() => {
    if (!selectedJobId) {
      setStreamingJob(null);
      setStreamEnded(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }
    setStreamEnded(false);
    let cancelled = false;
    apiFetch(`/api/jobs/${selectedJobId}`)
      .then((job) => {
        if (!cancelled) setStreamingJob(job);
      })
      .catch(() => {});
    const es = new EventSource(`${API_BASE}/api/jobs/${selectedJobId}/stream`);
    eventSourceRef.current = es;
    es.addEventListener("update", (event) => {
      try {
        const payload = JSON.parse(event.data);
        setStreamingJob(payload);
      } catch {}
    });
    es.addEventListener("done", (event) => {
      try {
        const payload = JSON.parse(event.data);
        setStreamingJob(payload);
      } catch {}
      setStreamEnded(true);
      es.close();
    });
    es.onerror = () => {
      setStreamEnded(true);
      es.close();
    };
    return () => {
      cancelled = true;
      es.close();
      eventSourceRef.current = null;
    };
  }, [selectedJobId]);

  useEffect(() => {
    const el = logPreRef.current;
    if (el && streamingJob?.output) el.scrollTop = el.scrollHeight;
  }, [streamingJob?.output]);

  const stopJob = async (jobId) => {
    try {
      await apiFetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
      loadJobs();
      if (selectedJobId === jobId) setStreamingJob((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (err) {
      console.error(err);
    }
  };

  const canStop = (job) => job.type === "oc-mirror-run" && job.status === "running";

  const completedCount = jobs.filter((j) => TERMINAL_STATUSES.includes(j.status)).length;

  const clearCompletedJobs = async () => {
    setClearing(true);
    try {
      await apiFetch("/api/jobs?completed=true", { method: "DELETE" });
      setShowClearConfirm(false);
      await loadJobs();
      if (selectedJobId && TERMINAL_STATUSES.includes(jobs.find((j) => j.id === selectedJobId)?.status)) {
        setSelectedJobId(null);
        setStreamingJob(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setClearing(false);
    }
  };

  const exportOperationsData = async () => {
    try {
      const data = await apiFetch("/api/jobs");
      const payload = {
        exportedAt: new Date().toISOString(),
        jobCount: (data.jobs || []).length,
        jobs: (data.jobs || []).map((j) => ({
          id: j.id,
          type: j.type,
          status: j.status,
          message: j.message,
          created_at: j.created_at,
          updated_at: j.updated_at,
          output: j.output || ""
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `operations-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="step-body">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Operations</h2>
          <div className="card-subtitle">
            All background jobs: operator scans, docs link updates, and oc-mirror runs. View logs and stop when safe.
          </div>
          {!loading && jobs.length > 0 ? (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <button type="button" className="ghost" onClick={exportOperationsData}>
                Export operations data
              </button>
              {completedCount > 0 ? (
                <button type="button" className="ghost" onClick={() => setShowClearConfirm(true)}>
                  Clear completed jobs
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="card-body">
          {loading ? (
            <div className="loading">Loading operations…</div>
          ) : jobs.length === 0 ? (
            <div className="note">No operations yet. Run an operator scan, update docs links, or run oc-mirror from their respective steps.</div>
          ) : (
            <div className="list">
              {jobs.map((job) => (
                <div key={job.id} className={`card ${selectedJobId === job.id ? "active" : ""}`} style={{ marginBottom: "12px" }}>
                  <div className="card-header" style={{ flexDirection: "row", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <span className="badge">{JOB_TYPE_LABELS[job.type] || job.type}</span>
                    <span className="badge" style={{ backgroundColor: job.status === "running" ? "#0ea5e9" : job.status === "completed" ? "#22c55e" : job.status === "failed" ? "#dc2626" : "#6b7280", color: "#fff" }}>
                      {job.status}
                    </span>
                    <span className="subtle">{job.created_at ? formatJobTime(job.created_at) : ""}</span>
                    {job.message ? <span className="subtle">{job.message}</span> : null}
                    <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}
                      >
                        {selectedJobId === job.id ? "Hide logs" : "View logs"}
                      </button>
                      {canStop(job) ? (
                        <button type="button" className="danger" onClick={() => stopJob(job.id)}>
                          Stop
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {selectedJobId === job.id ? (
                    <div className="card-body" style={{ paddingTop: 0 }}>
                      {streamEnded && (streamingJob?.output || job.output) ? (
                        <p className="note subtle" style={{ marginBottom: "6px", fontSize: "0.85rem" }}>Live stream ended. Log content below is final.</p>
                      ) : null}
                      <pre ref={logPreRef} className="preview log-stream" style={{ maxHeight: "320px", overflow: "auto" }}>
                        {(streamingJob && streamingJob.output) || job.output || "No logs yet."}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {showClearConfirm ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="clear-jobs-title">
          <div className="modal">
            <h3 id="clear-jobs-title">Clear completed jobs?</h3>
            <p className="modal-copy subtle">
              This will permanently remove {completedCount} completed, failed, or cancelled job{completedCount !== 1 ? "s" : ""} from the list. Running jobs are not affected.
            </p>
            <div className="actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="ghost" onClick={() => setShowClearConfirm(false)} disabled={clearing}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={clearCompletedJobs} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear completed jobs"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default OperationsStep;
