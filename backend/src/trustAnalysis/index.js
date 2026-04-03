import { createHash, X509Certificate } from "node:crypto";
import { RISK_BANDS, RISK_SCORING_DEFAULTS, TRUST_ANALYSIS_SCHEMA_VERSION } from "./riskConstants.js";

class TrustAnalysisHashMismatchError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TrustAnalysisHashMismatchError";
    this.code = "TRUST_ANALYSIS_HASH_MISMATCH";
    this.details = details;
  }
}

const normalizeNewlines = (value) => (value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const extractPemBlocks = (pem, source) => {
  const raw = normalizeNewlines(pem);
  const matches = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  return matches.map((block, index) => ({ pem: block.trim(), source, index }));
};

const toFingerprint = (x509) => (x509.fingerprint256 || "").replaceAll(":", "").toLowerCase();

const parseHost = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname) return null;
    const port = url.port ? `:${url.port}` : "";
    return `${url.hostname.toLowerCase()}${port}`;
  } catch {
    // Mirror refs can be host/path without scheme.
    const first = raw.split("/")[0].trim().toLowerCase();
    return first || null;
  }
};

const extractEndpointHosts = (state) => {
  const mirroring = state?.globalStrategy?.mirroring || {};
  const proxies = state?.globalStrategy?.proxies || {};
  const hosts = new Set();
  const add = (v) => {
    const h = parseHost(v);
    if (h) hosts.add(h);
  };
  add(mirroring.registryFqdn);
  (mirroring.sources || []).forEach((row) => {
    (row?.mirrors || []).forEach((mirror) => add(mirror));
  });
  add(proxies.httpProxy);
  add(proxies.httpsProxy);
  return Array.from(hosts).sort();
};

const parseCertRecord = (entry) => {
  try {
    const cert = new X509Certificate(entry.pem);
    const fingerprintSha256 = toFingerprint(cert);
    const fingerprintSha1 = (cert.fingerprint || "").replaceAll(":", "").toLowerCase();
    const keyType = cert.publicKey?.asymmetricKeyType || "unknown";
    const keyDetails = cert.publicKey?.asymmetricKeyDetails || {};
    const keySize = typeof keyDetails.modulusLength === "number"
      ? keyDetails.modulusLength
      : (typeof keyDetails.bits === "number" ? keyDetails.bits : null);
    const namedCurve = typeof keyDetails.namedCurve === "string" ? keyDetails.namedCurve : null;
    const isCa = cert.ca === true || /CA:TRUE/i.test(entry.pem);
    const notBefore = new Date(cert.validFrom).toISOString();
    const notAfter = new Date(cert.validTo).toISOString();
    const subject = cert.subject || "";
    const issuer = cert.issuer || "";
    const sanRaw = cert.subjectAltName || "";
    const sanDns = sanRaw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("DNS:"))
      .map((part) => part.slice(4).toLowerCase())
      .filter(Boolean);
    return {
      source: entry.source,
      sourceIndex: entry.index,
      parseStatus: "ok",
      rawPem: entry.pem,
      fingerprintSha256,
      fingerprintSha1,
      certId: fingerprintSha256 || `unidentified-${entry.source}-${entry.index}`,
      subject,
      issuer,
      serialNumber: cert.serialNumber || "",
      notBefore,
      notAfter,
      sanDns,
      isCa,
      isSelfSigned: Boolean(subject && issuer && subject === issuer),
      keyType,
      keySize,
      namedCurve,
      signatureAlgorithm: cert.signatureAlgorithm || "unknown"
    };
  } catch {
    return {
      source: entry.source,
      sourceIndex: entry.index,
      parseStatus: "malformed",
      rawPem: entry.pem,
      fingerprintSha256: null,
      fingerprintSha1: null,
      certId: `malformed-${entry.source}-${entry.index}`,
      subject: "",
      issuer: "",
      serialNumber: "",
      notBefore: null,
      notAfter: null,
      sanDns: [],
      isCa: false,
      isSelfSigned: false,
      keyType: "unknown",
      keySize: null,
      namedCurve: null,
      signatureAlgorithm: "unknown"
    };
  }
};

const dedupeByFingerprint = (records) => {
  const map = new Map();
  const duplicateNoise = [];
  for (const cert of records) {
    if (cert.parseStatus !== "ok" || !cert.fingerprintSha256) continue;
    if (!map.has(cert.fingerprintSha256)) {
      map.set(cert.fingerprintSha256, cert);
    } else {
      duplicateNoise.push(cert.fingerprintSha256);
    }
  }
  return { uniqueByFingerprint: map, duplicateNoiseCount: duplicateNoise.length };
};

const buildGraph = (validRecords) => {
  const byFingerprint = new Map(validRecords.map((r) => [r.fingerprintSha256, r]));
  const edges = [];
  const parentsByChild = new Map();
  const childrenByParent = new Map();
  for (const child of validRecords) {
    for (const parent of validRecords) {
      if (child.fingerprintSha256 === parent.fingerprintSha256) continue;
      if (child.issuer && parent.subject && child.issuer === parent.subject) {
        const edge = {
          from: child.fingerprintSha256,
          to: parent.fingerprintSha256,
          reason: "issuer_subject_match",
          confidence: "medium"
        };
        edges.push(edge);
        const parents = parentsByChild.get(child.fingerprintSha256) || [];
        parents.push(parent.fingerprintSha256);
        parentsByChild.set(child.fingerprintSha256, parents);
        const kids = childrenByParent.get(parent.fingerprintSha256) || [];
        kids.push(child.fingerprintSha256);
        childrenByParent.set(parent.fingerprintSha256, kids);
      }
    }
  }
  // Build undirected clusters.
  const clusters = [];
  const seen = new Set();
  const nodes = Array.from(byFingerprint.keys());
  for (const node of nodes) {
    if (seen.has(node)) continue;
    const stack = [node];
    const cluster = [];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      cluster.push(cur);
      const neighbors = new Set([
        ...(parentsByChild.get(cur) || []),
        ...(childrenByParent.get(cur) || [])
      ]);
      for (const n of neighbors) {
        if (!seen.has(n)) stack.push(n);
      }
    }
    clusters.push(cluster.sort());
  }
  return { edges, clusters, parentsByChild };
};

const classifyConfidence = ({ endpointLinkedCount, ambiguityCount, malformedCount, hasValid }) => {
  if (!hasValid || malformedCount >= 5) return "unable_to_classify";
  if (endpointLinkedCount > 0 && ambiguityCount === 0) return "high";
  if (endpointLinkedCount > 0 || hasValid) return "best_effort";
  return "unable_to_classify";
};

const computeRisk = ({ metrics }) => {
  const cfg = RISK_SCORING_DEFAULTS;
  let score = 0;
  const signals = [];
  const addSignal = (id, value) => signals.push({ id, value });
  if (metrics.certCount >= cfg.certCount.medium) {
    score += 1;
    addSignal("cert_count_medium", metrics.certCount);
  }
  if (metrics.certCount >= cfg.certCount.high) {
    score += 1;
    addSignal("cert_count_high", metrics.certCount);
  }
  if (metrics.certCount >= cfg.certCount.dangerous) {
    score += 1;
    addSignal("cert_count_dangerous", metrics.certCount);
  }
  if (metrics.bundleBytes >= cfg.bundleBytes.medium) {
    score += 1;
    addSignal("bundle_bytes_medium", metrics.bundleBytes);
  }
  if (metrics.bundleBytes >= cfg.bundleBytes.high) {
    score += 1;
    addSignal("bundle_bytes_high", metrics.bundleBytes);
  }
  if (metrics.bundleBytes >= cfg.bundleBytes.dangerous) {
    score += 1;
    addSignal("bundle_bytes_dangerous", metrics.bundleBytes);
  }
  if (metrics.lineCount >= cfg.lineCount.medium) {
    score += 1;
    addSignal("line_count_medium", metrics.lineCount);
  }
  if (metrics.lineCount >= cfg.lineCount.high) {
    score += 1;
    addSignal("line_count_high", metrics.lineCount);
  }
  if (metrics.unrelatedClusterCount >= cfg.unrelatedClusterCount.medium) {
    score += 1;
    addSignal("cluster_count_medium", metrics.unrelatedClusterCount);
  }
  if (metrics.unrelatedClusterCount >= cfg.unrelatedClusterCount.high) {
    score += 1;
    addSignal("cluster_count_high", metrics.unrelatedClusterCount);
  }
  if (metrics.malformedCount >= cfg.malformedCount.any) {
    score += 2;
    addSignal("malformed_present", metrics.malformedCount);
  }
  if (metrics.malformedCount >= cfg.malformedCount.high) {
    score += 1;
    addSignal("malformed_high", metrics.malformedCount);
  }
  if (metrics.leafCount >= cfg.leafCount.medium) {
    score += 1;
    addSignal("leaf_present", metrics.leafCount);
  }
  if (metrics.leafCount >= cfg.leafCount.high) {
    score += 1;
    addSignal("leaf_high", metrics.leafCount);
  }
  if (metrics.chainAmbiguityCount >= cfg.chainAmbiguityCount.medium) {
    score += 1;
    addSignal("chain_ambiguity", metrics.chainAmbiguityCount);
  }
  if (metrics.chainAmbiguityCount >= cfg.chainAmbiguityCount.high) {
    score += 1;
    addSignal("chain_ambiguity_high", metrics.chainAmbiguityCount);
  }
  if (metrics.duplicateNoiseCount >= cfg.duplicateNoiseCount.noisy) {
    score += 1;
    addSignal("duplicate_noise", metrics.duplicateNoiseCount);
  }
  if (metrics.nonCaIssuerMisuseCount > 0) {
    score += Math.min(6, metrics.nonCaIssuerMisuseCount * 3);
    addSignal("non_ca_issuer_misuse", metrics.nonCaIssuerMisuseCount);
  }

  let band = "minimal";
  for (const [label, range] of Object.entries(RISK_BANDS)) {
    if (score >= range.min && score <= range.max) {
      band = label;
      break;
    }
  }
  return { score, band, signals };
};

const categorizeFipsFindings = (validRecords, chainFindings) => {
  const now = Date.now();
  const findings = [];
  for (const cert of validRecords) {
    const sig = String(cert.signatureAlgorithm || "").toLowerCase();
    if (sig.includes("md5") || sig.includes("sha1")) {
      findings.push({
        id: "weak_signature",
        category: "cryptographic_weakness",
        severity: "high",
        confidence: "high",
        certId: cert.fingerprintSha256,
        message: "Certificate signature algorithm appears weak for FIPS-oriented installs."
      });
    }
    if (cert.keyType === "rsa" && typeof cert.keySize === "number" && cert.keySize < 2048) {
      findings.push({
        id: "weak_rsa_key",
        category: "cryptographic_weakness",
        severity: "high",
        confidence: "high",
        certId: cert.fingerprintSha256,
        message: "RSA key size is below 2048 bits."
      });
    }
    if (cert.keyType === "ec" && cert.namedCurve && !["prime256v1", "secp384r1", "secp521r1"].includes(cert.namedCurve)) {
      findings.push({
        id: "ec_curve_unknown",
        category: "unknown_or_ambiguous",
        severity: "medium",
        confidence: "medium",
        certId: cert.fingerprintSha256,
        message: "EC curve may not be approved in your environment crypto policy."
      });
    }
    const notBefore = cert.notBefore ? Date.parse(cert.notBefore) : null;
    const notAfter = cert.notAfter ? Date.parse(cert.notAfter) : null;
    if (typeof notAfter === "number" && !Number.isNaN(notAfter) && notAfter < now) {
      findings.push({
        id: "expired",
        category: "certificate_hygiene_validity",
        severity: "high",
        confidence: "high",
        certId: cert.fingerprintSha256,
        message: "Certificate is expired."
      });
    }
    if (typeof notBefore === "number" && !Number.isNaN(notBefore) && notBefore > now) {
      findings.push({
        id: "not_yet_valid",
        category: "certificate_hygiene_validity",
        severity: "medium",
        confidence: "high",
        certId: cert.fingerprintSha256,
        message: "Certificate is not yet valid."
      });
    }
    if (cert.signatureAlgorithm === "unknown") {
      findings.push({
        id: "signature_algorithm_unknown",
        category: "unknown_or_ambiguous",
        severity: "low",
        confidence: "low",
        certId: cert.fingerprintSha256,
        message: "Signature algorithm could not be determined reliably."
      });
    }
  }
  for (const issue of chainFindings) {
    findings.push({
      id: issue.id,
      category: "chain_or_issuer_misuse",
      severity: issue.severity,
      confidence: issue.confidence,
      certId: issue.certId,
      message: issue.message
    });
  }
  return findings;
};

const buildNormalizedHashInput = ({ validRecords, endpointHosts, fips }) => {
  const certs = validRecords
    .map((cert) => ({
      fingerprintSha256: cert.fingerprintSha256,
      source: cert.source,
      isCa: cert.isCa,
      subject: cert.subject,
      issuer: cert.issuer
    }))
    .sort((a, b) => a.fingerprintSha256.localeCompare(b.fingerprintSha256));
  const payload = {
    schema: TRUST_ANALYSIS_SCHEMA_VERSION,
    certs,
    endpointHosts: endpointHosts.slice().sort(),
    fips: Boolean(fips)
  };
  return JSON.stringify(payload);
};

const computeHash = (input) => createHash("sha256").update(input).digest("hex");

const minimizeBundle = ({ validRecords, endpointHosts, graph }) => {
  const reasonsByFingerprint = {};
  const endpointLinked = new Set();
  const endpointSans = endpointHosts.map((h) => h.split(":")[0]);
  for (const cert of validRecords) {
    const hit = cert.sanDns.some((dns) => endpointSans.includes(dns));
    if (hit) endpointLinked.add(cert.fingerprintSha256);
  }
  const selected = new Set();
  const addSelected = (fp, reason) => {
    if (!fp) return;
    selected.add(fp);
    reasonsByFingerprint[fp] = reasonsByFingerprint[fp] || [];
    reasonsByFingerprint[fp].push(reason);
  };

  // Prefer CAs/intermediates and endpoints-linked entries.
  for (const cert of validRecords) {
    if (cert.isCa && !cert.isSelfSigned) addSelected(cert.fingerprintSha256, "intermediate_candidate");
    if (cert.isCa && cert.isSelfSigned) addSelected(cert.fingerprintSha256, "root_anchor_candidate");
    if (endpointLinked.has(cert.fingerprintSha256)) addSelected(cert.fingerprintSha256, "endpoint_linked");
  }

  // Pull parent chain for selected nodes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fp of Array.from(selected)) {
      const parents = graph.parentsByChild.get(fp) || [];
      for (const parentFp of parents) {
        if (!selected.has(parentFp)) {
          selected.add(parentFp);
          reasonsByFingerprint[parentFp] = reasonsByFingerprint[parentFp] || [];
          reasonsByFingerprint[parentFp].push("issuer_chain_parent");
          changed = true;
        }
      }
    }
  }

  // Exclude likely leaf-only certs from reduced default set.
  for (const cert of validRecords) {
    if (!cert.isCa && selected.has(cert.fingerprintSha256)) {
      selected.delete(cert.fingerprintSha256);
      reasonsByFingerprint[cert.fingerprintSha256] = reasonsByFingerprint[cert.fingerprintSha256] || [];
      reasonsByFingerprint[cert.fingerprintSha256].push("excluded_leaf_default");
    }
  }

  const selectedCertFingerprints = Array.from(selected).sort();
  const excludedCertFingerprints = validRecords
    .map((cert) => cert.fingerprintSha256)
    .filter((fp) => !selected.has(fp))
    .sort();

  const ambiguityCount = Array.from(graph.parentsByChild.values()).filter((parents) => parents.length > 1).length;
  const confidence = classifyConfidence({
    endpointLinkedCount: endpointLinked.size,
    ambiguityCount,
    malformedCount: 0,
    hasValid: validRecords.length > 0
  });

  if (confidence === "unable_to_classify") {
    return {
      available: false,
      confidence,
      selectedCertFingerprints: [],
      excludedCertFingerprints: validRecords.map((cert) => cert.fingerprintSha256).sort(),
      reasonsByFingerprint,
      blockedReason: "Insufficient evidence to propose a trustworthy reduced bundle."
    };
  }

  return {
    available: true,
    confidence,
    selectedCertFingerprints,
    excludedCertFingerprints,
    reasonsByFingerprint
  };
};

const analyzeTrustState = (state) => {
  const trust = state?.trust || {};
  const mirrorBlocks = extractPemBlocks(trust.mirrorRegistryCaPem, "mirror");
  const proxyBlocks = extractPemBlocks(trust.proxyCaPem, "proxy");
  const allBlocks = [...mirrorBlocks, ...proxyBlocks];
  const parsedRecords = allBlocks.map(parseCertRecord);
  const validRecords = parsedRecords.filter((cert) => cert.parseStatus === "ok" && cert.fingerprintSha256);
  const malformedCount = parsedRecords.length - validRecords.length;
  const { uniqueByFingerprint, duplicateNoiseCount } = dedupeByFingerprint(parsedRecords);
  const dedupedValid = Array.from(uniqueByFingerprint.values());
  const endpointHosts = extractEndpointHosts(state);
  const graph = buildGraph(dedupedValid);

  let nonCaIssuerMisuseCount = 0;
  const chainFindings = [];
  for (const edge of graph.edges) {
    const parent = uniqueByFingerprint.get(edge.to);
    if (parent && !parent.isCa) {
      nonCaIssuerMisuseCount += 1;
      chainFindings.push({
        id: "non_ca_issuer_misuse",
        severity: "high",
        confidence: "high",
        certId: edge.from,
        message: "A non-CA certificate appears to act as an issuer."
      });
    }
  }

  const chainAmbiguityCount = Array.from(graph.parentsByChild.values()).filter((parents) => parents.length > 1).length;
  const leafCount = dedupedValid.filter((cert) => !cert.isCa).length;
  const clusterCount = graph.clusters.length;
  const unrelatedClusterCount = Math.max(0, clusterCount - (endpointHosts.length ? 1 : 0));
  const bundleBytes = Buffer.byteLength(normalizeNewlines(`${trust.mirrorRegistryCaPem || ""}\n${trust.proxyCaPem || ""}`), "utf8");
  const lineCount = normalizeNewlines(`${trust.mirrorRegistryCaPem || ""}\n${trust.proxyCaPem || ""}`).split("\n").length;
  const metrics = {
    certCount: dedupedValid.length,
    bundleBytes,
    lineCount,
    unrelatedClusterCount,
    malformedCount,
    leafCount,
    nonCaIssuerMisuseCount,
    chainAmbiguityCount,
    duplicateNoiseCount
  };

  const risk = computeRisk({ metrics });
  const proposal = minimizeBundle({ validRecords: dedupedValid, endpointHosts, graph });
  const confidence = proposal.confidence;
  const fipsFindings = categorizeFipsFindings(dedupedValid, chainFindings);
  const normalizedHashInput = buildNormalizedHashInput({
    validRecords: dedupedValid,
    endpointHosts,
    fips: state?.globalStrategy?.fips
  });
  const analysisHash = computeHash(normalizedHashInput);

  return {
    analysisSchemaVersion: TRUST_ANALYSIS_SCHEMA_VERSION,
    analysisHash,
    triggerHints: {
      bundleBytes,
      certCount: dedupedValid.length
    },
    endpointHosts,
    inventory: {
      totalBlocks: parsedRecords.length,
      validCertificates: dedupedValid.length,
      malformedBlocks: malformedCount,
      duplicateNoiseCount
    },
    metrics,
    risk,
    confidence,
    proposal,
    fips: {
      enabled: Boolean(state?.globalStrategy?.fips),
      findings: fipsFindings
    },
    certs: dedupedValid
      .slice()
      .sort((a, b) => a.fingerprintSha256.localeCompare(b.fingerprintSha256))
      .map((cert) => ({
        certId: cert.certId,
        fingerprintSha256: cert.fingerprintSha256,
        fingerprintSha1: cert.fingerprintSha1,
        source: cert.source,
        subject: cert.subject,
        issuer: cert.issuer,
        serialNumber: cert.serialNumber,
        notBefore: cert.notBefore,
        notAfter: cert.notAfter,
        sanDns: cert.sanDns,
        isCa: cert.isCa,
        isSelfSigned: cert.isSelfSigned,
        keyType: cert.keyType,
        keySize: cert.keySize,
        namedCurve: cert.namedCurve,
        signatureAlgorithm: cert.signatureAlgorithm
      })),
    explainability: {
      reasonsByFingerprint: proposal.reasonsByFingerprint
    }
  };
};

const buildReducedBundlePem = (analysis, selectedFingerprints) => {
  const wanted = new Set(selectedFingerprints || []);
  const certMap = new Map((analysis?.certs || []).map((cert) => [cert.fingerprintSha256, cert]));
  const selected = Array.from(wanted).sort();
  const pemBlocks = [];
  for (const fp of selected) {
    const cert = certMap.get(fp);
    if (!cert) {
      throw new TrustAnalysisHashMismatchError(
        "Reduced trust selection references certificates unavailable in current analysis.",
        { missingFingerprint: fp }
      );
    }
  }
  // Reparse from current trust payload is handled upstream; this helper expects embedded PEM map.
  const rawMap = new Map();
  // Back-compat: if analysis carried no raw PEMs, caller must supply mapping.
  for (const cert of analysis.rawCertificates || []) {
    if (cert.fingerprintSha256) rawMap.set(cert.fingerprintSha256, cert.rawPem);
  }
  for (const fp of selected) {
    const rawPem = rawMap.get(fp);
    if (rawPem) pemBlocks.push(rawPem);
  }
  if (!pemBlocks.length) {
    throw new TrustAnalysisHashMismatchError("Reduced trust bundle reconstruction produced no PEM blocks.");
  }
  return pemBlocks.join("\n\n");
};

const enrichAnalysisWithRawPemMap = (analysis, state) => {
  const trust = state?.trust || {};
  const blocks = [
    ...extractPemBlocks(trust.mirrorRegistryCaPem, "mirror"),
    ...extractPemBlocks(trust.proxyCaPem, "proxy")
  ];
  const parsed = blocks.map(parseCertRecord).filter((cert) => cert.parseStatus === "ok" && cert.fingerprintSha256);
  analysis.rawCertificates = parsed.map((cert) => ({
    fingerprintSha256: cert.fingerprintSha256,
    rawPem: cert.rawPem
  }));
  return analysis;
};

const resolveReducedBundleOrThrow = (state) => {
  const trust = state?.trust || {};
  const reducedSelection = trust.reducedSelection || null;
  if (!reducedSelection || !Array.isArray(reducedSelection.selectedCertFingerprints) || !reducedSelection.selectedCertFingerprints.length) {
    throw new TrustAnalysisHashMismatchError(
      "Reduced trust bundle mode was requested but no reduced selection is available.",
      { reason: "missing_reduced_selection" }
    );
  }
  const analysis = analyzeTrustState(state);
  if (reducedSelection.analysisHash !== analysis.analysisHash) {
    throw new TrustAnalysisHashMismatchError(
      "Reduced trust bundle selection is stale. Re-run trust analysis and reselect certificates.",
      {
        reason: "analysis_hash_mismatch",
        requestedAnalysisHash: reducedSelection.analysisHash,
        currentAnalysisHash: analysis.analysisHash,
        analysisHashMismatch: true
      }
    );
  }
  const enriched = enrichAnalysisWithRawPemMap(analysis, state);
  const proposalConfidence = enriched?.proposal?.confidence || "unable_to_classify";
  if (proposalConfidence === "unable_to_classify") {
    throw new TrustAnalysisHashMismatchError(
      "Reduced trust bundle mode is unavailable for the current inputs due to insufficient confidence.",
      { reason: "proposal_unavailable" }
    );
  }
  return {
    bundle: buildReducedBundlePem(enriched, reducedSelection.selectedCertFingerprints),
    analysisHash: analysis.analysisHash
  };
};

export {
  TrustAnalysisHashMismatchError,
  analyzeTrustState,
  extractEndpointHosts,
  resolveReducedBundleOrThrow
};

