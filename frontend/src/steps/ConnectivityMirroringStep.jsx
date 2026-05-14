/**
 * OpenShift Airgap Architect - Connectivity & Mirroring Configuration Step
 *
 * Image digest sources (mirror registry mapping), registry FQDN configuration,
 * and optional NTP servers. Auto-derives registry FQDN from mirror pull secret.
 * Supports both install-config and agent-config mirroring strategies.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { useEffect } from "react";
import { useApp } from "../store.jsx";
import { getScenarioId, getParamMeta } from "../catalogResolver.js";
import Banner from "../components/Banner.jsx";
import Button from "../components/Button.jsx";
import FieldLabelWithInfo from "../components/FieldLabelWithInfo.jsx";

const INSTALL_CONFIG = "install-config.yaml";
const AGENT_CONFIG = "agent-config.yaml";

/** Parse mirror registry FQDN from pull secret JSON (auths keys).
 * When unambiguous (exactly one auth entry), returns the registry hostname[:port] (normalized).
 * Otherwise returns { fqdn: null, authCount }.
 */
function deriveRegistryFqdnFromPullSecret(pullSecretJson) {
  if (!pullSecretJson || typeof pullSecretJson !== "string") return null;
  try {
    const data = JSON.parse(pullSecretJson);
    const auths = data?.auths;
    if (!auths || typeof auths !== "object") return null;
    const keys = Object.keys(auths);
    if (keys.length === 0) return { fqdn: null, authCount: 0 };
    if (keys.length !== 1) return { fqdn: null, authCount: keys.length };

    // Keys are expected to be registry hostname[:port]. If a scheme slips in, strip it.
    const key = String(keys[0] || "").trim();
    const normalized = key.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return { fqdn: normalized || null, authCount: 1 };
  } catch {
    return null;
  }
}

export default function ConnectivityMirroringStep({ highlightErrors, fieldErrors = {} }) {
  const { state, updateState } = useApp();
  const scenarioId = getScenarioId(state);
  const strategy = state.globalStrategy || {};
  const mirroring = strategy.mirroring || {};
  const sources = Array.isArray(mirroring.sources) && mirroring.sources.length > 0
    ? mirroring.sources
    : [{ source: "", mirrors: [""] }];

  const updateStrategy = (patch) => updateState({ globalStrategy: { ...strategy, ...patch } });
  const updateMirroring = (patch) =>
    updateStrategy({ mirroring: { ...mirroring, ...patch } });

  const creds = state.credentials || {};
  const pullSecretPlaceholder = creds.pullSecretPlaceholder || "";
  const mirrorRegistryPullSecret = creds.mirrorRegistryPullSecret || "";
  const defaultRegistryFqdn = "registry.local:5000";

  // Keep UI gating consistent with backend output gating.
  const redHatHasContent = pullSecretPlaceholder.trim() && pullSecretPlaceholder.trim() !== "{\"auths\":{}}";
  const mirrorHasContent = mirrorRegistryPullSecret.trim() && mirrorRegistryPullSecret.trim() !== "{\"auths\":{}}";
  const useMirrorPath = Boolean(creds.usingMirrorRegistry) || (!redHatHasContent && mirrorHasContent);
  const showMirroringConfig = useMirrorPath;

  const [mirrorFqdnDerivationWarning, setMirrorFqdnDerivationWarning] = React.useState("");

  useEffect(() => {
    const currentFqdn = (mirroring.registryFqdn || "").trim();
    const shouldDerive = !currentFqdn || currentFqdn === defaultRegistryFqdn;
    if (!shouldDerive) return;

    const mirrorPullSecret = state.credentials?.mirrorRegistryPullSecret;
    const derived = deriveRegistryFqdnFromPullSecret(mirrorPullSecret);
    if (!derived) return;

    if (derived.fqdn) {
      setMirrorFqdnDerivationWarning("");
      const prevFqdn = (mirroring.registryFqdn || "").trim();
      const updatedSources = sources.map((src) => ({
        ...src,
        mirrors: (src.mirrors || []).map((mirror) =>
          mirror.startsWith(prevFqdn) ? mirror.replace(prevFqdn, derived.fqdn) : mirror
        )
      }));
      updateMirroring({ registryFqdn: derived.fqdn, sources: updatedSources });
      return;
    }

    if (derived.authCount > 1) {
      setMirrorFqdnDerivationWarning("Mirror pull secret contains multiple registries; Local Registry FQDN requires manual entry.");
    }
  }, [state.credentials?.mirrorRegistryPullSecret, mirroring.registryFqdn]);

  const ntpServersArray = Array.isArray(strategy.ntpServers) ? strategy.ntpServers : (typeof strategy.ntpServers === "string" ? strategy.ntpServers.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const [ntpInput, setNtpInput] = React.useState(() => ntpServersArray.join(", "));
  const ntpInputRef = React.useRef(ntpInput);

  // Keep ref updated
  React.useEffect(() => {
    ntpInputRef.current = ntpInput;
  }, [ntpInput]);

  // Sync from store only when not actively editing
  React.useEffect(() => {
    const nextStr = ntpServersArray.join(", ");
    if (nextStr !== ntpInputRef.current) {
      setNtpInput(nextStr);
    }
  }, [ntpServersArray.join(",")]);

  const updateNtpServers = (value) => {
    updateStrategy({
      ntpServers: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4)
    });
  };

  const handleRegistryFqdnChange = (nextFqdn) => {
    const prevFqdn = mirroring.registryFqdn || "";
    const updatedSources = sources.map((src) => ({
      ...src,
      mirrors: (src.mirrors || []).map((mirror) =>
        mirror.startsWith(prevFqdn) ? mirror.replace(prevFqdn, nextFqdn) : mirror
      )
    }));
    updateMirroring({ registryFqdn: nextFqdn, sources: updatedSources });
  };

  const metaImageDigest = getParamMeta(scenarioId, "imageDigestSources", INSTALL_CONFIG);
  const metaNtp = getParamMeta(scenarioId, "additionalNTPSources", AGENT_CONFIG);
  const isAwsGovCloud = scenarioId === "aws-govcloud-ipi" || scenarioId === "aws-govcloud-upi";
  const showNtpSection = !isAwsGovCloud;

  return (
    <div className="step">
      <div className="step-header">
        <div className="step-header-main">
          <h2>Connectivity & Mirroring</h2>
          <p className="subtle">Local registry mirror mapping and NTP for install-config and agent-config.</p>
        </div>
      </div>

      <div className="step-body">
        {state.reviewFlags?.["connectivity-mirroring"] && state.ui?.visitedSteps?.["connectivity-mirroring"] ? (
          <Banner variant="warning">
            Version or upstream selections changed. Review this page to ensure settings are still valid.
            <div className="actions">
              <Button variant="secondary" onClick={() => updateState({ reviewFlags: { ...state.reviewFlags, "connectivity-mirroring": false } })}>
                Re-evaluate this page
              </Button>
            </div>
          </Banner>
        ) : null}
        {showMirroringConfig ? (
          <section className={`card ${fieldErrors.mirrorSources ? "highlight-errors" : ""}`}>
            <div className="card-header">
              <div>
                <h3 className="card-title">Mirroring Configuration</h3>
                <div className="card-subtitle">Define local registry and mirror mapping.</div>
              </div>
            </div>
            <div className="card-body">
              <FieldLabelWithInfo
                label="Local Registry FQDN"
                hint={`Fully qualified domain name and port of your local mirror registry.

**What is this:**
The endpoint where your mirrored OpenShift images are hosted

**Format:**
hostname[:port] or IP[:port]

**How it's used:**
Prepopulates imageDigestSources in install-config.yaml

**Important:**
⚠️ The authoritative values come from the IDMS manifest generated by **oc-mirror v2**

**Example:**
registry.corp.local:5000`}
                required={metaImageDigest?.required}
              >
                <input
                  value={mirroring.registryFqdn || ""}
                  onChange={(e) => handleRegistryFqdnChange(e.target.value)}
                  placeholder="registry.corp.local:5000"
                />
              </FieldLabelWithInfo>
              {mirrorFqdnDerivationWarning ? <div className="note warning">{mirrorFqdnDerivationWarning}</div> : null}
              <div className="mirror-list">
                <div className="mirror-header">
                  <span>Source registry</span>
                  <span>Mirror registry (one or more)</span>
                  <span>Actions</span>
                </div>
                {sources.map((source, idx) => (
                  <div key={idx} className="mirror-row">
                    <input
                      value={source.source || ""}
                      onChange={(e) => {
                        const next = [...sources];
                        next[idx] = { ...next[idx], source: e.target.value };
                        updateMirroring({ sources: next });
                      }}
                      onBlur={(e) => {
                        const next = [...sources];
                        next[idx] = { ...next[idx], source: e.target.value };
                        updateMirroring({ sources: next });
                      }}
                      placeholder="quay.io/openshift-release-dev/ocp-release"
                    />
                    <input
                      value={(source.mirrors || []).join(",")}
                      onChange={(e) => {
                        const next = [...sources];
                        next[idx] = {
                          ...next[idx],
                          mirrors: e.target.value.split(",").map((m) => m.trim())
                        };
                        updateMirroring({ sources: next });
                      }}
                      onBlur={(e) => {
                        const next = [...sources];
                        next[idx] = {
                          ...next[idx],
                          mirrors: e.target.value.split(",").map((m) => m.trim())
                        };
                        updateMirroring({ sources: next });
                      }}
                      placeholder={`${mirroring.registryFqdn || "registry.local:5000"}/ocp-release`}
                    />
                    <button
                      className="ghost"
                      type="button"
                      disabled={sources.length === 1 || idx < 2}
                      onClick={() => {
                        if (!window.confirm("Remove this mirror mapping?")) return;
                        const next = sources.filter((_, index) => index !== idx);
                        updateMirroring({ sources: next });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="ghost"
                  type="button"
                  onClick={() =>
                    updateMirroring({ sources: [...sources, { source: "", mirrors: [""] }] })
                  }
                >
                  Add Mirror Path
                </button>
              </div>
              <div className="note">
                Remove any auto-added paths you do not plan to mirror.
              </div>
            </div>
          </section>
        ) : null}

        {showNtpSection ? (
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Time & NTP</h3>
              <div className="card-subtitle">Keep the installer and nodes time-synchronized.</div>
            </div>
          </div>
          <div className="card-body">
            <FieldLabelWithInfo
              label="NTP Servers (comma-separated)"
              hint={`Up to four reliable NTP sources to keep cluster time synchronized.

**Why this matters:**
⚠️ Time skew is a **common install failure** - certificates won't validate if clocks are off

**Format:**
Comma-separated hostnames or IP addresses

**Where this goes:**
${scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent" ? "agent-config.yaml → additionalNTPSources" : "Used during installation to keep nodes synchronized"}

**Best practice:**
Use internal NTP servers that are reachable from your airgap network

**Example:**
time.corp.local,10.90.0.10`}
              required={metaNtp?.required}
            >
              <input
                value={ntpInput}
                onChange={(e) => setNtpInput(e.target.value)}
                onBlur={(e) => updateNtpServers(e.target.value)}
                placeholder="time.corp.local,10.90.0.10"
              />
            </FieldLabelWithInfo>
          </div>
        </section>
        ) : null}
      </div>
    </div>
  );
}
