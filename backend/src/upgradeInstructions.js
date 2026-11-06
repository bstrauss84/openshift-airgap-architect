/**
 * Disconnected update instructions (v2.3.0, RFC §9.1): OpenShift Update
 * Service (recommended), CLI without OSUS, and the web console.
 *
 * Rules:
 *  - The cluster's Cluster Version Operator performs the update; Architect
 *    only explains it. Nothing here runs against a cluster.
 *  - Each hop cites the documentation of the minor the cluster is updated
 *    INTO (data/upgrade-docs/upgrade-docs.json); 5.0 documentation is never
 *    cited for 4.20–4.22.
 *  - Never generated: --force, --allow-upgrade-with-warnings,
 *    --allow-not-recommended, `oc adm upgrade accept`.
 *  - A conditional hop gets no executable update command: its risk, any
 *    imported cluster evaluation, the administrator's recorded judgment and
 *    the version-matched documentation are shown instead.
 *  - The CLI path without OSUS uses the release digest from the update graph
 *    (`--to-image <registry>/…@sha256:…`), as the disconnected procedure
 *    requires, never a tag.
 *  - Commands carry the readiness checks still open ("run only after …");
 *    a Control Plane Only procedure is withheld until its documented
 *    prerequisites are verified or (where only the administrator can know)
 *    attested.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import fs from "node:fs";
import path from "node:path";
import { getMinorVersion } from "../../shared/versionUtils.js";
import { canonicalDataRoot } from "./canonicalDataRoot.js";

let docsCache = null;
export const loadUpgradeDocs = () => {
  if (!docsCache) docsCache = JSON.parse(fs.readFileSync(path.join(canonicalDataRoot(), "upgrade-docs", "upgrade-docs.json"), "utf8"));
  return docsCache;
};

/** A documentation reference for one topic at one minor. */
export const docRef = (topic, minor) => {
  const d = loadUpgradeDocs();
  const t = d.topics[topic];
  if (!t || !d.supportedMinors.includes(minor)) return null;
  return {
    topic,
    minor,
    title: `${t.title} (OpenShift ${minor})`,
    url: `${d.base}/${minor}/${t.path}${t.anchor ? `#${t.anchor}` : ""}`,
    verification: d.verification?.[minor]?.[topic] || "unverified",
    humanVerified: Boolean(d.humanVerified?.[minor]?.[topic])
  };
};

const cmd = (label, text, extra = {}) => ({ label, text, ...extra });
const digestOf = (payload) => (typeof payload === "string" && payload.includes("@sha256:") ? payload.slice(payload.indexOf("@") + 1) : null);
const registryPath = (url) => String(url || "").replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");

/**
 * @param {object} plan
 * @param {object} ctx
 * @param {object} ctx.readiness - evaluateReadiness() result
 * @param {string} [ctx.registry] - destination registry and path (no credentials), e.g. mirror.example.com:8443/ocp
 * @param {Record<string,string>} [ctx.clusterResources] - stage id → cluster-resources directory a completed run produced
 */
export function buildInstructions(plan, { readiness, registry = "", clusterResources = {} } = {}) {
  const path0 = plan.path;
  if (!path0?.hops?.length) return { ok: false, code: "PATH_REQUIRED", message: "Compute the update route first." };
  const reg = registryPath(registry) || "<mirror-registry>/<path>";
  const target = plan.target;
  const targetMinor = getMinorVersion(target);
  const open = (readiness?.checks || []).filter((c) => c.state === "BLOCKED" || c.state === "NOT_CHECKED");
  const openIds = open.map((c) => c.id);
  const cpoRequested = plan.strategy === "cpo";
  const cpoAllowed = cpoRequested && readiness?.cpo?.eligible === true;
  const status = {
    state: readiness?.summary?.state || "incomplete",
    message: readiness?.summary?.state === "ready-to-proceed"
      ? "Every readiness check is verified or attested. Follow the steps in order."
      : `This procedure is conditional: ${open.length} readiness check(s) are blocked or not checked (${openIds.slice(0, 8).join(", ")}${openIds.length > 8 ? ", …" : ""}). Each step lists what must be confirmed before you run it.`,
    clusterReadiness: readiness?.summary?.clusterReadiness || "not verified (no cluster evidence)"
  };
  const stageFor = (release) => plan.stages.find((s) => s.release === release) || null;
  const releaseRepo = `${reg}/openshift/release-images`;

  // One-time OSUS setup, documented in the TARGET minor (procedures are identical in 4.20–4.22).
  const osusSetup = [
    { title: "Make the registry trusted for the update service", doc: docRef("disconnected-osus", targetMinor), kind: "template",
      body: "The OpenShift Update Service pulls release images from your mirror registry. Add its CA under the key updateservice-registry in a ConfigMap and reference it from the cluster image configuration (skip if the registry is already trusted this way).",
      commands: [
        cmd("Create the trust ConfigMap (your CA file)", "oc create configmap registry-config --from-file=updateservice-registry=<path-to-registry-ca.crt> -n openshift-config"),
        cmd("Reference it from the image configuration", `oc patch image.config.openshift.io/cluster --type merge -p '{"spec":{"additionalTrustedCA":{"name":"registry-config"}}}'`)
      ] },
    { title: "Install the OpenShift Update Service Operator", doc: docRef("disconnected-osus", targetMinor), kind: "template",
      body: "Mirror the cincinnati-operator package from the redhat-operator-index catalog (add it to a stage's operators), then install it from the CatalogSource oc-mirror created. See the UpdateService artifacts for the Namespace, OperatorGroup and Subscription templates.",
      commands: [cmd("Check the operator is installed", "oc get csv -n openshift-update-service")] },
    { title: "Provide the graph data", doc: docRef("disconnected-osus", targetMinor), kind: "info",
      body: plan.stages[0] ? `Stage 1 (${plan.stages[0].release}) mirrors the graph-data image (graph: true); oc-mirror then writes cluster-resources/updateService.yaml naming it. Without it, build the graph-data image as the documentation describes.` : "Prepare the stages first; stage 1 mirrors the graph-data image." },
    { title: "Create the UpdateService", doc: docRef("disconnected-osus", targetMinor), kind: "template",
      body: "Prefer the updateService.yaml that oc-mirror wrote for stage 1 (it names your registry). The template in the artifacts is equivalent.",
      commands: [
        cmd("Apply oc-mirror's UpdateService", `oc apply -f ${clusterResources.s1 ? `${clusterResources.s1}/updateService.yaml` : "<stage-1 cluster-resources>/updateService.yaml"}`),
        cmd("Wait for the policy engine URI", "oc get updateservice -n openshift-update-service -o jsonpath='{.items[0].status.policyEngineURI}{\"\\n\"}'")
      ] },
    { title: "Point the cluster at the update service", doc: docRef("disconnected-osus", targetMinor), kind: "command",
      body: "The Cluster Version Operator reads update recommendations from this upstream. The route's TLS certificate must be trusted (cluster-wide proxy trustedCA when it is not signed by a trusted CA).",
      commands: [
        cmd("Read the graph URL", "NAMESPACE=openshift-update-service; NAME=$(oc get updateservice -n $NAMESPACE -o jsonpath='{.items[0].metadata.name}'); POLICY_ENGINE_GRAPH_URI=\"$(oc -n $NAMESPACE get updateservice $NAME -o jsonpath='{.status.policyEngineURI}/api/upgrades_info/v1/graph{\"\\n\"}')\"; echo $POLICY_ENGINE_GRAPH_URI"),
        cmd("Set the upstream", "oc patch clusterversion version --type merge -p \"{\\\"spec\\\":{\\\"upstream\\\":\\\"${POLICY_ENGINE_GRAPH_URI}\\\"}}\""),
        cmd("Check the service answers for your channel", `curl -sS --fail "$POLICY_ENGINE_GRAPH_URI?channel=${path0.hops[0].channel}" | head -c 300`)
      ],
      requires: openIds.filter((id) => id === "osus-health") }
  ];

  const cpoSteps = (when) => (cpoAllowed ? [{
    title: when === "before" ? "Pause every pool except master (Control Plane Only)" : "Unpause the pools",
    doc: docRef("control-plane-only", targetMinor), kind: "command",
    body: when === "before" ? "Worker nodes stay on 4.20 while the control plane goes through 4.21 to 4.22; they update once, at the end." : "The worker nodes now update directly to the final release.",
    commands: [cmd(when === "before" ? "Pause non-master pools" : "Unpause non-master pools", `for pool in $(oc get mcp -o jsonpath='{range .items[?(@.metadata.name!="master")]}{.metadata.name}{" "}{end}'); do oc patch mcp/$pool --type merge -p '{"spec":{"paused":${when === "before"}}}'; done`)]
  }] : []);

  const hopSteps = (method) => path0.hops.map((hop, i) => {
    const minor = getMinorVersion(hop.to);
    const stage = stageFor(hop.to);
    const prevChannel = i === 0 ? plan.currentChannel : path0.hops[i - 1].channel;
    const steps = [];
    const docs = [docRef(method === "cli" ? "disconnected-no-osus" : method === "osus" ? "disconnected-osus" : "performing", minor), docRef("preparing", minor)].filter(Boolean);
    const requires = openIds.filter((id) => id === `content-${stage?.id}` || id === `signatures-${stage?.id}` || ["cvo-health", "cvo-upgradeable", "etcd-backup", "operator-compat", "mcp-health", "graph-freshness", "route", "current-version"].includes(id) || (id === "admin-acks" && minor === "4.22"));
    steps.push({ title: `Make the ${hop.to} content available to the cluster`, kind: "command",
      body: stage ? `Stage ${stage.id.slice(1)} must be in the registry (verified). Apply the cluster resources its disk-to-mirror or mirror-to-mirror run wrote: ImageDigestMirrorSet / ImageTagMirrorSet, the ${minor} CatalogSource, and the release signature ConfigMap.` : "Prepare this release as a stage first.",
      commands: stage ? [cmd("Apply the stage's cluster resources", `oc apply -f ${clusterResources[stage.id] || `<stage-${stage.id.slice(1)} cluster-resources directory>`}/`)] : [],
      doc: docRef("oc-mirror-v2", minor) });
    if (hop.kind === "minor") {
      steps.push({ title: `Update Operators so they support OpenShift ${minor}`, kind: "info", doc: docRef("operators-admin", getMinorVersion(hop.from)),
        body: `Before updating to ${minor}, every installed Operator must be at a version that supports ${minor} (otherwise the cluster reports Upgradeable=False). Update them from the ${getMinorVersion(hop.from)} catalog first; Architect never approves InstallPlans.` });
    }
    if (hop.conditional) {
      steps.push({ title: `${hop.from} → ${hop.to} is a conditional update`, kind: "risk", doc: docRef("conditional-updates", minor),
        body: "No executable update command is generated for a conditional update. Review each risk, evaluate it on the cluster, and follow the documentation. Acknowledging a risk here records your judgment; it does not make the update safe for your cluster.",
        risks: hop.risks,
        commands: [cmd("Evaluate on the cluster (read-only)", `oc adm upgrade recommend --version ${hop.to}`)] });
      return { index: i, from: hop.from, to: hop.to, channel: hop.channel, kind: hop.kind, conditional: true, docs, steps };
    }
    if (method === "web") {
      if (hop.channel !== prevChannel) steps.push({ title: `Set the channel to ${hop.channel}`, kind: "console", doc: docRef("performing", minor), body: `Administration → Cluster Settings → Details → Channel → ${hop.channel} → Save.`, requires });
      steps.push({ title: `Update to ${hop.to}`, kind: "console", doc: docRef("performing", minor), body: `Administration → Cluster Settings → Details → Select a version → ${hop.to} → Update. The list shows only what the cluster's update service recommends; ${hop.to} appears once the update service and stage ${stage?.id?.slice(1) || "?"} content are in place.`, requires });
      steps.push({ title: "Watch the update", kind: "console", doc: docRef("performing", minor), body: "Administration → Cluster Settings shows progress; Compute → MachineConfigPools shows node updates. Wait for Completed before the next step." });
    } else if (method === "osus") {
      if (hop.channel !== prevChannel) steps.push({ title: `Change the channel to ${hop.channel}`, kind: "command", doc: docRef("understanding-updates", minor), commands: [cmd("Set the channel", `oc adm upgrade channel ${hop.channel}`)], requires });
      steps.push({ title: `Update to ${hop.to}`, kind: "command", doc: docRef("disconnected-osus", minor), requires,
        commands: [
          cmd("Confirm the cluster recommends it (read-only)", `oc adm upgrade recommend --version ${hop.to}`),
          cmd("Start the update", `oc adm upgrade --to=${hop.to}`)
        ] });
      steps.push({ title: "Watch the update", kind: "command", doc: docRef("performing", minor), commands: [cmd("Status", "oc adm upgrade status"), cmd("Cluster operators", "oc get clusteroperators")] });
    } else {
      const digest = digestOf(hop.payload);
      steps.push({ title: `Update to ${hop.to} by digest`, kind: "command", doc: docRef("disconnected-no-osus", minor), requires,
        body: `Without the update service, the cluster is told the exact release image. ${hop.to}'s digest comes from the update graph (${hop.payload || "unknown"}); the image must already be in your registry (stage ${stage?.id?.slice(1) || "?"}).`,
        commands: digest ? [
          cmd("Check the release image is in the registry (read-only)", `oc adm release info ${releaseRepo}@${digest} | head -5`),
          cmd("Start the update", `oc adm upgrade --allow-explicit-upgrade --to-image ${releaseRepo}@${digest}`)
        ] : [] });
      steps.push({ title: "Watch the update", kind: "command", doc: docRef("performing", minor), commands: [cmd("Status", "oc adm upgrade status"), cmd("Cluster version", "oc get clusterversion")] });
    }
    if (hop.controlPlaneOnly) steps.push({ title: "Control plane only", kind: "info", doc: docRef("control-plane-only", targetMinor), body: "Only the control plane updates to 4.21 in this step; the paused pools stay on 4.20." });
    return { index: i, from: hop.from, to: hop.to, channel: hop.channel, kind: hop.kind, conditional: false, docs, steps };
  });

  const cliPrereqs = [
    { title: "Apply the release signature ConfigMap of each stage", kind: "command", doc: docRef("disconnected-no-osus", targetMinor),
      body: "Without the update service the cluster must already hold each release's signature. oc-mirror writes it as cluster-resources/signature-configmap.json in every disk-to-mirror or mirror-to-mirror run.",
      commands: plan.stages.map((s) => cmd(`Stage ${s.id.slice(1)} (${s.release})`, `oc apply -f ${clusterResources[s.id] || `<stage-${s.id.slice(1)} cluster-resources>`}/signature-configmap.json`)) },
    { title: "Pause MachineHealthChecks during the update", kind: "command", doc: docRef("disconnected-no-osus", targetMinor),
      body: "The documented prerequisite for updating without the update service; remove the annotation after the update.",
      commands: [cmd("Pause every MachineHealthCheck", "for mhc in $(oc get machinehealthcheck -n openshift-machine-api -o jsonpath='{.items[*].metadata.name}'); do oc -n openshift-machine-api annotate machinehealthcheck $mhc cluster.x-k8s.io/paused=\"\"; done")] }
  ];

  const methods = {};
  for (const method of ["osus", "cli", "web"]) {
    methods[method] = {
      method,
      recommended: method === "osus",
      note: method === "web" ? "The web console updates through the cluster's update service: set up the OpenShift Update Service first (OSUS tab, steps 1–5). It cannot update to an explicit image." : method === "cli" ? "Use this when no OpenShift Update Service runs in the disconnected environment." : "Recommended: the update service gives the cluster the same recommendations, including conditional-update risks, that a connected cluster gets.",
      setup: method === "osus" || method === "web" ? osusSetup : cliPrereqs,
      before: cpoSteps("before"),
      hops: hopSteps(method),
      after: cpoSteps("after"),
      cpo: cpoRequested ? (cpoAllowed
        ? { state: "included", message: "The Control Plane Only steps are included because their documented prerequisites are verified or attested." }
        : { state: "withheld", message: `The Control Plane Only pause/unpause steps are withheld until these are verified or attested: ${(readiness?.cpo?.missing || []).join(", ")}. Without them, follow the standard per-step update.`, doc: docRef("control-plane-only", targetMinor) }) : null
    };
  }
  return {
    ok: true,
    status,
    target,
    targetMinor,
    route: path0.path,
    selectedBy: path0.selectedBy,
    tieBreakNote: path0.selectedBy === "default-convention" ? "Among equally short recommended routes, the one with the highest release at each step is shown by convention. That is not a safety ranking; you may choose another route." : "You chose this route.",
    methods,
    never: ["--force", "--allow-upgrade-with-warnings", "--allow-not-recommended", "oc adm upgrade accept"]
  };
}
