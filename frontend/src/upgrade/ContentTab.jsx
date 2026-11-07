/**
 * OpenShift Airgap Architect - Upgrade › 2 Content (v2.3.0 UX correction).
 *
 * What will be mirrored for each release on the route. A stage is one release: its platform
 * release (fixed by the route) plus operators from THAT minor's catalog. Operator selection is
 * Mirroring's own experience, embedded per stage (Quick Picks, catalog scan, browse, selected
 * operators, version constraints, Live catalog check) — no second operator UI. The plan's single
 * credential context (D-2) supplies the Red Hat pull secret. "Import previous configuration"
 * suggests operators from earlier ImageSetConfigurations; it never proves what is installed.
 *
 * Mirroring the stages is a later step (Mirror & transfer); nothing here runs oc-mirror.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/Button.jsx";
import Banner from "../components/Banner.jsx";
import Modal from "../components/Modal.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";
import OperatorsSection from "../mirroring/OperatorsSection.jsx";
import AdditionalImagesEditor from "../mirroring/AdditionalImagesEditor.jsx";
import { fetchMirroring, updateProfile } from "../mirroring/mirroringApi.js";
import PresetImporter, { CATEGORY_LABEL, CONFIDENCE_LABEL, SOURCE_TO_KIND } from "./OperatorsTab.jsx";
import { prepareStages, saveOperatorIntent, copyStageOperators, fetchStageConfig } from "./upgradeApi.js";

export const downloadText = (name, text, type = "application/yaml") => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** One row per operator across the route; one column per stage (its channel, or —). */
function OperatorMatrix({ plan, views, profiles, readOnly, onIntent }) {
  const rows = useMemo(() => {
    const byKey = new Map();
    views.forEach((v, col) => {
      const p = profiles[v.linkedProfileId];
      if (!p?.content?.operators) return;
      for (const op of p.operators.selected) {
        const key = `${op.catalog || "redhat"}|${op.name}`;
        if (!byKey.has(key)) byKey.set(key, { key, name: op.displayName || op.name, catalog: op.catalog || "redhat", cells: views.map(() => null) });
        byKey.get(key).cells[col] = op.defaultChannel || "catalog default";
      }
    });
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [views, profiles]);
  const intent = new Map((plan.operatorIntent || []).map((e) => [e.key, e]));
  if (!rows.length) return <p className="subtle">No operators chosen yet. Choose them for a stage below (Quick Picks, catalog browser), or import a previous configuration.</p>;
  return (
    <div className="upgrade-table-scroll">
      <table className="upgrade-graph-table upgrade-operator-matrix">
        <caption className="sr-only">Operators on each stage of the route</caption>
        <thead>
          <tr>
            <th scope="col">Operator</th>
            <th scope="col">Category</th>
            {views.map((v) => <th scope="col" key={v.id}>Stage {v.id.slice(1)} · {v.release}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const e = intent.get(r.key);
            return (
              <tr key={r.key}>
                <th scope="row">{r.name}<span className="subtle"> ({r.catalog})</span></th>
                <td className="upgrade-matrix-category">
                  <select aria-label={`${r.name} category`} value={e?.category || "requested"} disabled={readOnly}
                    onChange={(ev) => onIntent({ name: r.key.split("|")[1], catalogKind: r.catalog, category: ev.target.value, confidence: e?.confidence || "user-entered", sources: e?.sources || [], channel: e?.channel || null })}>
                    {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <span className="upgrade-badge" data-state={!e || e.confidence === "imported-preset" ? "NOT_CHECKED" : e.confidence === "cluster-export" ? "VERIFIED" : "ATTESTED"}>
                    {e ? CONFIDENCE_LABEL[e.confidence] : "chosen here"}
                  </span>
                  {e?.confidence === "imported-preset" && !readOnly ? (
                    <Button variant="secondary" className="mini" onClick={() => onIntent({ name: e.name, catalogKind: e.catalogKind, channel: e.channel, sources: e.sources, confidence: "user-confirmed", category: e.category === "preset-mirrored" ? "installed" : e.category })}>Confirm installed</Button>
                  ) : null}
                </td>
                {r.cells.map((c, i) => <td key={views[i].id}>{c || <span className="subtle" aria-label="not selected">—</span>}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ContentTab({ plan, onPlanChanged, onShowOperation = null, credentialKey = null, onPreviewFiles = null, onGoToStep = null }) {
  const [profiles, setProfiles] = useState({});
  const [selected, setSelected] = useState(plan.stages[0]?.id || null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const received = plan.kind === "received";

  const loadProfiles = useCallback(async () => {
    try {
      const m = await fetchMirroring();
      setProfiles(Object.fromEntries((m.profiles || []).map((p) => [p.id, p])));
    } catch (err) {
      setError(`Could not load the stage profiles: ${String(err.message || err)}`);
    }
  }, []);
  useEffect(() => { loadProfiles(); }, [loadProfiles, plan.stages.length]);
  useEffect(() => { if (selected && !plan.stages.some((s) => s.id === selected)) setSelected(plan.stages[0]?.id || null); }, [plan.stages, selected]);
  useEffect(() => { if (!selected && plan.stages[0]) setSelected(plan.stages[0].id); }, [plan.stages, selected]);

  const prepare = async () => {
    setBusy("prepare");
    setError("");
    try {
      const r = await prepareStages(plan.id);
      onPlanChanged(r.plan);
      await loadProfiles();
      setSelected(r.plan.stages[0]?.id || null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const saveIntent = async (entry) => {
    setError("");
    try { onPlanChanged((await saveOperatorIntent(plan.id, { entries: [entry], replaceConfirmed: true })).plan); } catch (err) { setError(String(err.message || err)); }
  };
  const copyLater = async (stageId) => {
    setBusy("copy");
    setError("");
    try {
      const r = await copyStageOperators(plan.id, stageId);
      onPlanChanged(r.plan);
      await loadProfiles();
      setNotice(`${r.report.map((x) => `Stage ${x.stageId.slice(1)}: ${x.added?.length || 0} added${x.kept?.length ? `, ${x.kept.length} already selected (unchanged)` : ""}`).join("; ")}. Each later stage uses its own minor's catalog: check the channels there with its catalog scan and Live catalog check.`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy("");
    }
  };
  const recordInstalled = async () => {
    const entries = (plan.inventory?.operators || [])
      .filter((o) => o.name && SOURCE_TO_KIND[o.source])
      .map((o) => ({ name: o.name, catalogKind: SOURCE_TO_KIND[o.source], channel: o.channel || null, category: "installed", confidence: "cluster-export", sources: [{ file: `cluster export ${plan.inventory.importedAt || ""}`.trim() }] }));
    setError("");
    try {
      onPlanChanged((await saveOperatorIntent(plan.id, { entries })).plan);
      setNotice(`${entries.length} installed operator(s) from the imported cluster export recorded as installed. Choose them for the stages that need them.`);
    } catch (err) { setError(String(err.message || err)); }
  };
  const stageConfig = async (profile, view, action) => {
    setError("");
    try {
      const r = await fetchStageConfig(profile.id);
      const name = `stage-${view.id.slice(1)}-${view.release}-imageset-config.yaml`;
      if (action === "download") downloadText(name, r.imagesetConfig);
      else if (onPreviewFiles) onPreviewFiles([{ name, content: r.imagesetConfig }]);
    } catch (err) {
      setError(`The configuration for stage ${view.id.slice(1)} is not ready yet: ${String(err.message || err)}`);
    }
  };

  if (!plan.path) {
    return (
      <section className="card">
        <h3>Content</h3>
        <p className="subtle">Compute the update route first: each release on it becomes one stage of content.</p>
        {onGoToStep ? <div className="actions"><Button variant="primary" onClick={() => onGoToStep("route")}>Go to Route</Button></div> : null}
      </section>
    );
  }
  const views = plan.stageViews || [];
  const view = views.find((s) => s.id === selected) || null;
  const profile = view?.linkedProfileId ? profiles[view.linkedProfileId] : null;
  const replaceProfile = (p) => { setProfiles((all) => ({ ...all, [p.id]: p })); };
  const stageIndex = views.findIndex((v) => v.id === selected);

  return (
    <div className="upgrade-content">
      {error ? <Banner variant="error">{error}</Banner> : null}
      {notice ? <Banner variant="info">{notice}</Banner> : null}
      <section className="card" aria-labelledby={`upgrade-stages-${plan.id}`}>
        <h3 id={`upgrade-stages-${plan.id}`}>Content for each release on the route</h3>
        <p className="subtle">
          Each release the cluster passes through ({plan.path.path.slice(1).join(", ")}) is one stage: its platform release and the operators you need from that minor&apos;s catalog.
        </p>
        {plan.stagesStale ? <Banner variant="warning">The route changed after the stages were prepared. Prepare them again; stage profiles whose release left the route stay as ordinary Mirroring profiles with their history.</Banner> : null}
        {(!plan.stages.length || plan.stagesStale) && !received ? (
          <div className="actions">
            <Button variant="primary" disabled={busy === "prepare"} onClick={prepare}>{busy === "prepare" ? "Preparing…" : plan.stages.length ? "Prepare the stages again" : `Prepare ${plan.path.path.length - 1} stage(s)`}</Button>
          </div>
        ) : null}
        {views.length ? (
          <div className="upgrade-stage-chips-row">
            <div className="upgrade-stage-chips" role="group" aria-label="Stage shown below">
              {views.map((s) => (
                <button key={s.id} type="button" className={`upgrade-stage-chip${selected === s.id ? " selected" : ""}`} aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}>
                  Stage {s.id.slice(1)} · {s.release}{s.operatorsSelected ? <span className="subtle"> · {s.operatorsSelected} operator{s.operatorsSelected === 1 ? "" : "s"}</span> : null}
                </button>
              ))}
            </div>
            {!received ? <Button variant="secondary" onClick={() => setImportOpen(true)}>Import previous configuration…</Button> : null}
          </div>
        ) : null}
      </section>

      {views.length ? (
        <section className="card" aria-labelledby={`upgrade-matrix-${plan.id}`}>
          <h3 id={`upgrade-matrix-${plan.id}`}>Operators across the route</h3>
          <OperatorMatrix plan={plan} views={views} profiles={profiles} readOnly={received} onIntent={saveIntent} />
          <div className="actions">
            {!received && stageIndex >= 0 && stageIndex < views.length - 1 ? (
              <Button variant="secondary" disabled={busy === "copy" || !profile?.operators?.selected?.length} onClick={() => copyLater(view.id)}>Copy stage {view.id.slice(1)}&apos;s operators to later stages</Button>
            ) : null}
            {!received && plan.inventory?.operators?.length ? <Button variant="secondary" onClick={recordInstalled}>Record the {plan.inventory.operators.length} installed operator(s) from the cluster export</Button> : null}
          </div>
          <p className="subtle">Category is what you intend for each operator; the badge says how that is known. Imported files and your own choices are never shown as installed until you confirm it or a cluster export shows it.</p>
        </section>
      ) : null}

      {view ? (
        <section className="card" aria-labelledby={`upgrade-stage-detail-${plan.id}`}>
          <h3 id={`upgrade-stage-detail-${plan.id}`}>Stage {view.id.slice(1)} · {view.release} <span className="subtle">· operator catalog {view.minor}</span></h3>
          {!profile ? (
            <p className="subtle">{received ? "No transfer for this stage has been received on this server yet." : "Prepare the stages to create this stage's content."}</p>
          ) : (
            <>
              <div className="actions">
                <Button variant="secondary" onClick={() => stageConfig(profile, view, "preview")} disabled={!onPreviewFiles}>Preview this stage&apos;s ImageSetConfiguration</Button>
                <Button variant="secondary" onClick={() => stageConfig(profile, view, "download")}>Download it</Button>
              </div>
              {!received && !profile.content?.operators ? (
                <div className="actions">
                  <Button variant="primary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { platform: true, operators: true, additionalImages: Boolean(profile.content?.additionalImages) } }))}>Choose operators for this stage ({view.minor} catalog)</Button>
                </div>
              ) : null}
              {!received && profile.content?.operators ? (
                <OperatorsSection key={`operators-${profile.id}`} profile={profile} onProfileChanged={replaceProfile} onProfilesChanged={loadProfiles} onShowOperation={onShowOperation} credentialKey={credentialKey} />
              ) : null}
              {!received ? (
                <CollapsibleSection title="Additional images" subtitle={profile.additionalImages?.length ? `${profile.additionalImages.length} for this stage` : "None for this stage"} defaultCollapsed wrapInCard={false}>
                  {profile.content?.additionalImages ? (
                    <AdditionalImagesEditor key={`images-${profile.id}`} profile={profile} onProfileChanged={replaceProfile} />
                  ) : (
                    <div className="actions"><Button variant="secondary" onClick={async () => replaceProfile(await updateProfile(profile.id, { content: { ...profile.content, platform: true, additionalImages: true } }))}>Add additional images to this stage</Button></div>
                  )}
                </CollapsibleSection>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <Modal isOpen={importOpen} onClose={() => setImportOpen(false)} ariaLabelledBy={`upgrade-import-config-${plan.id}`}>
        <h3 id={`upgrade-import-config-${plan.id}`}>Import previous configuration</h3>
        <p className="modal-copy subtle">Load one or more ImageSetConfiguration files you used before. They suggest operators, images and release hints. A file says what was asked to be mirrored — not what is installed or in your registry — so everything stays “imported preset — unverified”.</p>
        <PresetImporter plan={plan} onPlanChanged={(p) => { onPlanChanged(p); loadProfiles(); }} onClose={() => setImportOpen(false)} />
      </Modal>
    </div>
  );
}
