# Backend image build troubleshooting

The backend image (`backend/Containerfile`) downloads `oc` and `oc-mirror` from
`https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/<channel>/` at build
time. `backend/scripts/resolve-ocp-tool.sh` resolves, verifies and installs each tool. It
fails the build, with a `FATAL:` line, rather than install anything it could not verify.

## `FATAL: no SHA256 for oc-mirror.tar.gz`

**Confirmed cause (2026-11-19).** Red Hat moved the global channel `clients/ocp/latest` to
**OpenShift 5.0.1**. That release's `sha256sum.txt` lists **no oc-mirror artifact at all**,
on any architecture (x86_64, aarch64, ppc64le, s390x): there is neither `oc-mirror.tar.gz`
nor `oc-mirror.rhel9.tar.gz`. The artifact was not renamed and the checksum format did not
change; the channel simply no longer ships oc-mirror.

Builds that still used `OC_MIRROR_CHANNEL=latest` failed at this step in Tekton and in local
Podman. The 4.x channels still publish oc-mirror with checksums: `latest-4.22`,
`stable-4.22` and `fast-4.22` all resolve 4.22.22 with both `oc-mirror.tar.gz` and
`oc-mirror.rhel9.tar.gz`.

**Fix.** `OC_MIRROR_CHANNEL` now defaults to `latest-<newest supported minor>` (today
`latest-4.22`). The app's runtime oc-mirror download, used for bundles, uses the same rule.
oc-mirror 4.22.z has `--v2 list operators`, which operator discovery needs; 4.21.z does
not have it.

The same upstream change also broke the Field Guide (`FIELD_MANUAL.md`). Its manual
download command, `…/clients/ocp/latest/oc-mirror.tar.gz`, is now a 404. A guide never names
another minor, so its command now uses the guide's own minor,
`…/clients/ocp/latest-<minor>/oc-mirror.tar.gz`. All of `latest-4.20`, `latest-4.21` and
`latest-4.22` publish oc-mirror, and the guides use no `list operators` step.

**If you still see it:**

- A pipeline or build script passes `--build-arg OC_MIRROR_CHANNEL=latest`. Remove the
  argument, or set it to `latest-4.22`.
- To pin an exact build for reproducibility, pass `OCP_MIRROR_URL` together with
  `OCP_MIRROR_SHA256`. A URL without its checksum is refused.

Never work around it by skipping the checksum, by using a different unverified file, or by
disabling TLS verification. The build refuses all three.

## Other `FATAL:` messages from the tool step

| Message | Meaning | What to do |
|---|---|---|
| `release.txt does not match its sha256sum.txt entry` | The channel changed between two requests during the build (Red Hat published a new patch), or its metadata is inconsistent. | Retry the build. |
| `<channel> resolved to X, which is not a <minor> release` | The channel's `release.txt` names a release from another minor. | Check the channel name; report it if it persists. |
| `failed SHA-256 verification` | The download does not match the published checksum (corrupt download, an intercepting proxy changing content, or a wrong `*_SHA256` override). | Retry. If it persists behind a proxy, check that the proxy does not rewrite downloads. Re-check any override. |
| `is built for ELF machine 0x…, not <arch>` | The archive holds a binary for another architecture. | Check `--platform` and the architecture of the build host. |
| `does not contain <tool>` / `is not a regular file` / `is not an ELF executable` | The archive's contents are not what Red Hat normally ships. | Do not override. Report it. |
| `TLS verification failed … (curl 60)` and similar | An HTTPS-inspecting proxy. | Supply its CA as the `oaa_build_ca` build secret (README: Corporate CA and proxy). |
| `could not connect` / `HTTP error … (curl 22)` | Proxy or network policy, or a channel or file that does not exist. | Check `HTTPS_PROXY` / `NO_PROXY`, and that `mirror.openshift.com` is allowed. |

## Why not keep following the global `latest`?

`latest` is a moving pointer to Red Hat's newest release of any major version. It crossed a
major version and stopped publishing oc-mirror without notice. That breaks every rebuild,
including rebuilds of an already-released tag.

The policy is now:

- **oc-mirror** follows the newest patch of the newest minor the product supports. This
  moves forward automatically when a new minor is added to `SUPPORTED_MINORS`.
- **oc** follows the selected target minor at runtime.
- **Release builds** can be made fully reproducible with `OCP_MIRROR_URL` +
  `OCP_MIRROR_SHA256` (and `OCP_CLIENT_URL` + `OCP_CLIENT_SHA256`).

Every build records the resolved version, checksum and channel in
`/app/tools-provenance.env`.
