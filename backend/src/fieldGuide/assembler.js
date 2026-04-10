/**
 * Compartment selection, ordering, and guide rendering.
 */
import { compartments_v420 } from "./v4.20/index.js";
import { render } from "./template.js";

/**
 * Returns the compartment list for a given OCP minor version.
 * Add branches here when new versions are supported.
 */
const getCompartmentsForVersion = (minor) => {
  // if (minor === "4.21") return compartments_v421;
  return compartments_v420; // default / fallback to latest known
};

/**
 * Tests whether a compartment's conditions match the given context.
 * All specified condition fields must match (AND).
 * Within each list, any entry matches (OR).
 */
const matchesConditions = (compartment, ctx) => {
  const { conditions } = compartment;
  if (!conditions) return true;

  // platforms: OR match
  if (conditions.platforms && conditions.platforms.length > 0) {
    if (!conditions.platforms.includes(ctx.platform)) return false;
  }

  // methodologies: OR match
  if (conditions.methodologies && conditions.methodologies.length > 0) {
    const methodMatch =
      conditions.methodologies.includes(ctx.methodology) ||
      // normalize: "Agent-Based Installer" ↔ "Agent"
      conditions.methodologies.some((m) => {
        if (m === "Agent") return ctx.methodology === "Agent-Based Installer";
        if (m === "Agent-Based Installer") return ctx.methodology === "Agent";
        return false;
      });
    if (!methodMatch) return false;
  }

  // connectivities: OR match
  if (conditions.connectivities && conditions.connectivities.length > 0) {
    if (!conditions.connectivities.includes(ctx.connectivity)) return false;
  }

  // arbitrary predicate
  if (typeof conditions.when === "function") {
    if (!conditions.when(ctx)) return false;
  }

  return true;
};

/**
 * Renders a single item into markdown lines.
 * Returns an array of strings (no trailing newline).
 */
const renderItem = (item, num, ctx) => {
  const lines = [];
  const text = render(item.text || "", ctx);
  lines.push(`${num}. ${text}`);
  if (item.cmd) {
    const rendered = render(item.cmd, ctx);
    lines.push("   ```");
    rendered.split("\n").forEach((l) => lines.push(`   ${l}`));
    lines.push("   ```");
  }
  return lines;
};

/**
 * Renders a single compartment into markdown lines.
 */
const renderCompartment = (compartment, sectionNum, totalSections, ctx) => {
  const lines = [];
  const title = render(compartment.title, ctx);
  lines.push(`## Section ${sectionNum} of ${totalSections} — ${title}`);
  lines.push("");

  // doc refs for this compartment
  if (compartment.docRefs && compartment.docRefs.length > 0) {
    const sourceLinks = compartment.docRefs.map((ref) => `[${ref.label}](${ref.url})`).join(" | ");
    lines.push(`*Sources: ${sourceLinks}*`);
    lines.push("");
  }

  compartment.items.forEach((item, i) => {
    renderItem(item, i + 1, ctx).forEach((l) => lines.push(l));
  });

  lines.push("");
  lines.push("---");
  lines.push("");
  return lines;
};

/**
 * Selects matching compartments and sorts by order.
 */
const selectAndOrder = (versionMinor, ctx) => {
  const all = getCompartmentsForVersion(versionMinor);
  return all.filter((c) => matchesConditions(c, ctx)).sort((a, b) => a.order - b.order);
};

/**
 * Merges compartment docRefs with the existing docsLinks from docs.js.
 * Deduplicates by URL; prefers validated entries.
 */
const mergeDocLinks = (compartments, docsLinks) => {
  const byUrl = new Map();

  // Add existing validated docs first
  (docsLinks || []).forEach((link) => {
    byUrl.set(link.url, link);
  });

  // Add compartment docRefs (only if URL not already present with validated=true)
  compartments.forEach((c) => {
    (c.docRefs || []).forEach((ref) => {
      const existing = byUrl.get(ref.url);
      if (!existing || existing.validated === false) {
        byUrl.set(ref.url, { label: ref.label, url: ref.url });
      }
    });
  });

  return Array.from(byUrl.values());
};

/**
 * Renders the full field guide markdown string.
 */
const renderGuide = (state, ctx, docsLinks) => {
  const selected = selectAndOrder(ctx.versionMajorMinor, ctx);
  const total = selected.length;
  const lines = [];

  // Header
  lines.push(`# OpenShift Field Guide — ${ctx.clusterName}.${ctx.baseDomain}`);
  lines.push(`*Generated for: ${ctx.platform} / ${ctx.methodology} / ${ctx.connectivityLabel} / OCP ${ctx.version}*`);
  lines.push("");

  if (ctx.draftMode) {
    lines.push(`> ⚠ DRAFT / NOT VALIDATED: Warnings were present at export time. Review before use.`);
    lines.push("");
  }

  // Configuration summary (assumptions block — from existing state)
  lines.push("## Configuration Summary");
  lines.push("");
  lines.push(`- **OpenShift version:** ${ctx.version} (channel: ${ctx.channel})`);
  lines.push(`- **Platform:** ${ctx.platform}`);
  lines.push(`- **Install method:** ${ctx.methodology}`);
  lines.push(`- **Connectivity:** ${ctx.connectivityLabel}`);
  lines.push(`- **FIPS mode:** ${ctx.fips ? "Enabled" : "Disabled"}`);
  lines.push(`- **Proxy:** ${ctx.proxyEnabled ? "Enabled" : "Disabled"}`);
  if (ctx.proxyEnabled) {
    lines.push(`  - HTTP proxy: ${ctx.httpProxy || "not set"}`);
    lines.push(`  - HTTPS proxy: ${ctx.httpsProxy || "not set"}`);
    lines.push(`  - No proxy: ${ctx.noProxy || "not set"}`);
  }
  lines.push(`- **Mirror registry:** ${ctx.usingMirrorRegistry ? ctx.registryFqdn : "not used"}`);
  lines.push(`- **Trust bundle:** ${ctx.trustBundleConfigured ? "Configured" : "None"}`);
  lines.push(`- **NTP servers:** ${ctx.ntpServers || "Not configured"}`);
  lines.push(`- **Cluster FQDN:** ${ctx.clusterFqdn}`);
  lines.push(`- **API VIP:** ${ctx.apiVip}`);
  lines.push(`- **Ingress VIP:** ${ctx.ingressVip}`);
  lines.push(`- **Operators:** ${ctx.operatorList}`);
  lines.push(`- **Placeholders marked for later completion:** ${ctx.placeholderCount}`);
  lines.push(`- **Review needed:** ${ctx.reviewNeeded ? "Yes" : "No"}`);
  lines.push(`- **Execution-ready finality:** ${ctx.finalizable ? "Ready for final execution checks" : "Not execution-ready until review actions are completed"}`);
  lines.push("");
  lines.push("### Inclusion policy snapshot");
  lines.push(`- Pull secret: ${ctx.inclusionSummary.pullSecret}`);
  lines.push(`- Platform credentials: ${ctx.inclusionSummary.platformCredentials}`);
  lines.push(`- Mirror registry credentials: ${ctx.inclusionSummary.mirrorRegistryCredentials}`);
  lines.push(`- BMC credentials: ${ctx.inclusionSummary.bmcCredentials}`);
  lines.push(`- Trust bundle and certificates: ${ctx.inclusionSummary.trustBundleAndCertificates}`);
  lines.push(`- SSH public key: ${ctx.inclusionSummary.sshPublicKey}`);
  lines.push(`- Proxy values: ${ctx.inclusionSummary.proxyValues}`);
  if (ctx.placeholderCount > 0) {
    lines.push("");
    lines.push("> Values shown as `<<MARK FOR LATER COMPLETION: ...>>` are intentional placeholders. Replace them before running oc-mirror or installation execution actions.");
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Compartment sections
  selected.forEach((compartment, i) => {
    renderCompartment(compartment, i + 1, total, ctx).forEach((l) => lines.push(l));
  });

  // Sources section
  const allDocs = mergeDocLinks(selected, docsLinks);
  lines.push("## Official Documentation Sources");
  lines.push("");
  lines.push("All sources referenced in this guide:");
  lines.push("");
  if (allDocs.length === 0) {
    lines.push("- Documentation links could not be validated. Use the \"Update Docs Links\" action to refresh.");
  } else {
    const unverified = allDocs.filter((l) => l.validated === false);
    if (unverified.length > 0) {
      lines.push("- Some links could not be validated automatically. Please verify before use.");
      lines.push("");
    }
    allDocs.forEach((link) => {
      const suffix = link.validated === false ? " *(unverified)*" : "";
      lines.push(`- [${link.label}](${link.url})${suffix}`);
    });
  }
  lines.push("");

  return lines.join("\n");
};

export { selectAndOrder, renderGuide };
