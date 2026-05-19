# Field Manual: Signature Verification in oc-mirror

## Overview

OpenShift Airgap Architect provides three tiers of signature verification control when mirroring operators with oc-mirror:

| Tier | Granularity | Use Case | Version | UI Control |
|------|-------------|----------|---------|------------|
| **Tier 1: Per-image** | Most granular | Auto-retry on signature errors | v1.5.0+ | Automatic |
| **Tier 2: Per-registry** | Medium | Manual pre-emptive disabling | v1.4.0+ | Manual toggles |
| **Tier 3: Global** | Least granular | Emergency breakglass | v1.4.0+ | Manual toggle |

## Why Signature Verification Matters

Starting with oc-mirror v2, Red Hat added support for container image signature verification using cosign/sigstore. This provides cryptographic proof that images haven't been tampered with since publication.

**However**, not all registries publish signature manifests:
- ✅ **Red Hat registries** (registry.redhat.io, quay.io/openshift-release-dev) → Signatures **always** work
- ⚠️ **Certified operators** (registry.connect.redhat.com, registry.marketplace.redhat.com) → Some operators **missing** signatures
- ⚠️ **Community operators** (quay.io/operatorhubio) → Rarely have signatures

When oc-mirror attempts to verify signatures for an image that doesn't have them, it fails with:

```
error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator@sha256:...
error: reading signatures: reading manifest sha256-*.sig in registry.connect.redhat.com/netapp/trident-operator:
name unknown: Image not found
```

## Automatic Smart Retry (v1.5.0+)

**Recommended approach**: Let the app automatically handle signature failures.

When oc-mirror completes with warnings due to signature verification errors, the application automatically:

1. **Parses the job output logs** to detect signature verification errors
2. **Identifies images that failed** signature verification (extracts registry paths from error messages)
3. **Generates per-image registries.d configs** (most granular approach per Red Hat's recommendation)
4. **Launches an automatic retry** with signature verification disabled **ONLY** for failing images

### Example Scenario: NetApp Trident Operator

**Problem:**
- NetApp Trident operator has **11 container images**
- **1 image** fails signature verification (missing .sig manifest)
- **10 images** have valid signatures

**What happens:**

1. **Initial run:** oc-mirror attempts to mirror all 11 images with signature verification enabled
2. **Partial failure:** 10/11 images succeed, 1 fails with signature error
3. **Smart detection:** App parses logs, finds failing image path: `registry.connect.redhat.com/netapp/trident-operator`
4. **Targeted config generation:** Creates per-image registries.d YAML:
   ```yaml
   docker:
     registry.connect.redhat.com/netapp/trident-operator:
       use-sigstore-attachments: false
   ```
5. **Auto-retry:** Launches new oc-mirror job with same imageset-config + per-image signature disabling
6. **Success:** All 11 images mirrored. 10 images kept signature verification, 1 disabled.

**Security benefit:** Maximum signature verification retained (91% of images still verified).

### UI Indication

When smart retry is triggered, you'll see:

**In the completion modal:**
```
Signature Verification Failures Detected

1 image(s) failed signature verification due to missing .sig files:
  • registry.connect.redhat.com/netapp/trident-operator

✅ Auto-retry launched with per-image signature disabling (Job #42)
```

**In the Operations tab:**
- Original job shows `completed_with_warnings` status
- Retry job appears automatically with description: "Auto-retry (signature errors from job 41)"
- Both jobs' logs are preserved for audit trail

### Manual Retry

If automatic retry is disabled or fails, you can manually re-run oc-mirror. The UI will display which specific image paths need signature disabling in the completion modal.

## Manual Pre-emptive Controls (v1.4.0+)

If you know in advance that certain operators have signature issues, you can pre-emptively disable signature verification **before** the first run.

### Tier 2: Per-Registry Disabling

**Location:** Run oc-mirror step → Advanced Options → Signature Verification section (collapsible)

**Toggles:**
- **Disable signature verification for certified operators** - Disables for ALL certified operator images (registry.connect.redhat.com, registry.marketplace.redhat.com)
- **Disable signature verification for community operators** - Disables for ALL community operator images (quay.io/operatorhubio)

**When to use:**
- Mirroring multiple certified operators known to have signature issues
- Time-critical deployments where you don't want to wait for auto-retry
- Repeatable/scripted workflows

**Trade-off:** Disables signatures for entire registry, not just problematic operators.

### Tier 3: Global Disabling

**Location:** Run oc-mirror step → Advanced Options → Signature Verification section

**Toggle:** "Remove ALL signatures (emergency fallback)"

**What it does:** Adds `--remove-signatures` flag to oc-mirror command, disabling signature verification for **all images** (including Red Hat releases).

**When to use:**
- Emergency only
- Systematic registry-wide signature failures
- Debugging/troubleshooting

**⚠️ Security impact:** No signature verification for any images, including OpenShift release images.

## How It Works Technically

### Per-Image Configs (Tier 1)

The smart retry system uses the `containers/image` library's `registries.d` configuration format, as documented in Red Hat's [Solution Article 7139982](https://access.redhat.com/solutions/7139982):

**Generated config format:**
```yaml
docker:
  registry.connect.redhat.com/netapp/trident-operator:
    use-sigstore-attachments: false
  registry.connect.redhat.com/netapp/trident-operator-bundle:
    use-sigstore-attachments: false
```

**Environment variable:** `CONTAINERS_REGISTRIES_D` points oc-mirror to the directory containing these YAML files.

**Key field:** `use-sigstore-attachments: false` disables cosign/sigstore signature verification (OCI artifact signatures).

### Per-Registry Configs (Tier 2)

Similar approach but broader scope:

```yaml
docker:
  registry.connect.redhat.com:
    use-sigstore-attachments: false
```

This disables signatures for **all images** from `registry.connect.redhat.com`, not just specific paths.

### Global Flag (Tier 3)

Simply adds `--remove-signatures` to the oc-mirror command line. No registries.d configs needed.

## Troubleshooting

### Smart Retry Didn't Trigger

**Check:**
1. Job status is `completed_with_warnings` (not `failed`)
2. Release images succeeded (all release images must mirror for retry to trigger)
3. Signature failures detected in logs (look for "reading signatures: ... name unknown: Image not found")
4. Request body stored in job metadata (v1.5.0+ stores this automatically)

**View in Operations tab:** Original job metadata shows `signatureFailures` array and `retryRecommended: true`.

### Retry Job Also Failed

**Possible causes:**
- Different error type (not signature-related) - check retry job logs
- Network issues
- Registry authentication expired

**Next steps:**
1. Check retry job logs in Operations tab
2. If still signature errors, manually toggle Tier 2 controls and re-run
3. If different error, address root cause (timeouts, auth, etc.)

### How to Disable Smart Retry

Smart retry is always enabled when signature failures are detected. If you don't want automatic retry:

**Option 1:** Use Tier 2 manual toggles before first run (prevents signature failures)

**Option 2:** Cancel the retry job immediately in Operations tab

**Option 3:** Remove failed operators from imageset-config and re-run

## Best Practices

### 1. Let Smart Retry Handle It (Default)

✅ **Do:** Run oc-mirror with default settings (all signatures enabled)  
✅ **Do:** Let smart retry automatically fix signature failures  
✅ **Do:** Review retry job results in Operations tab

❌ **Don't:** Pre-emptively disable Tier 2 toggles unless you know operators fail  
❌ **Don't:** Use Tier 3 global disabling as first resort

### 2. Pre-emptive Disabling for Known Issues

**Scenario:** Mirroring 5 NetApp operators + 10 Red Hat operators

✅ **Do:** Enable "Disable certified operators" toggle before first run  
✅ **Do:** Verify Red Hat operators still get signature verification (they use different registries)

❌ **Don't:** Use global --remove-signatures (Red Hat operators lose verification too)

### 3. Audit Trail

✅ **Do:** Check Operations tab after smart retry to see what was disabled  
✅ **Do:** Review `signatureFailures` array in job metadata  
✅ **Do:** Keep logs for compliance audits

### 4. Security Considerations

**Signature verification provides defense-in-depth:**
- Detects image tampering
- Validates publisher authenticity
- Meets compliance requirements (FIPS, FedRAMP, etc.)

**Disabling signatures is safe when:**
- Images come from trusted registries (Red Hat Certified Partners)
- You verify image digests manually (SHA256 hashes)
- You have other integrity checks (image scanning, CVE analysis)

**Never disable signatures if:**
- Compliance requires cryptographic verification
- Images come from untrusted sources
- You can't manually verify image integrity

## Version History

### v1.5.0 (Current)
- ✅ Smart retry with per-image granularity
- ✅ Automatic error detection from logs
- ✅ Surgical signature disabling (only failing images)
- ✅ Follows Red Hat recommended best practice

### v1.4.0
- ✅ Per-registry signature toggles (certified/community)
- ✅ Global --remove-signatures emergency fallback
- ✅ Safe defaults (all signatures verified)

### v1.3.0 and earlier
- No signature controls (always verified, operators failed if missing .sig)

## References

- [Red Hat Solution 7139982](https://access.redhat.com/solutions/7139982) - Per-image signature disabling (official Red Hat recommendation)
- [containers/image registries.d documentation](https://github.com/containers/image/blob/main/docs/containers-registries.d.5.md) - Technical reference for registries.d format
- [oc-mirror documentation](https://docs.openshift.com/container-platform/latest/installing/disconnected_install/installing-mirroring-disconnected.html) - Official oc-mirror usage guide

## Support

**Questions/Issues:** File an issue at https://github.com/anthropics/openshift-airgap-architect/issues

**Feature Requests:** Smart retry is extensible - if you have operators that consistently fail, let us know and we can add them to a known-failures database for pre-emptive handling.
