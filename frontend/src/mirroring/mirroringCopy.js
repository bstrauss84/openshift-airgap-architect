/**
 * OpenShift Airgap Architect - Mirroring help content (v2.2.0)
 *
 * Help text for Mirroring fields, kept in one place so the structural and
 * help-quality tests can read it. Every hint follows the repository format
 * (template literal; what / why / when / examples / ⚠️ caveats) and never
 * merely repeats its label.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { getNewestSupportedMinor } from "../shared/versionPolicy.js";

/* Version examples are derived from the supported-minor policy, never hardcoded. */
const EXAMPLE_MINOR = getNewestSupportedMinor();

export const PROFILE_NAME_HINT = `A name you choose so you can tell profiles apart, for example "Platform ${EXAMPLE_MINOR} + AI operators".

**What a profile is:**
One independent mirroring plan. Each profile keeps its own content selection, its own OpenShift release and its own archive, workspace and cache directories on the server, so profiles never share or overwrite each other's mirror data.

**When to create another profile:**
• Different content for different sites or teams.
• Platform and operator mirrors that you update on different schedules.

**Important notes:**
• The name is a label only. It does not appear in the generated ImageSetConfiguration.
• ⚠️ A name is not a secret. Do not put credentials in it.
• Up to 80 characters.`;

export const CONTENT_TYPES_HINT = `Choose what this profile mirrors. Any combination is allowed.

**OpenShift platform:**
The release payload for one exact OpenShift release, for example ${EXAMPLE_MINOR}.0. Needed to install or update a disconnected cluster. You choose and lock a supported release.

**Operators:**
Packages from the Red Hat, certified and community operator catalogs. Catalogs are published per OpenShift minor: with platform content they follow the platform release's minor; operators on their own need a catalog minor you choose.

**Additional images:**
Any other container images, such as tools or virtual machine disks. These need no OpenShift version.

**Low side vs high side:**
You plan the content and mirror it to disk on the connected (low) side, then prepare a transfer — the archive files plus a checksum list and instructions — and carry it to the disconnected (high) side. There it is received (every file checked) and loaded into your registry with disk to mirror. If one machine can reach both the internet and your registry, mirror to mirror copies straight across instead.

**Important notes:**
• Deselecting a type keeps its settings; they return if you select it again.
• ⚠️ The disconnected side needs only the transfer and its own registry credentials; nothing is downloaded there.`;

export const CONTENT_TYPES = [
  {
    key: "platform",
    title: "OpenShift platform",
    description: "The release payload for one exact OpenShift release, chosen and locked in this profile."
  },
  {
    key: "operators",
    title: "Operators",
    description: "Packages from the Red Hat, certified and community catalogs for a chosen OpenShift minor."
  },
  {
    key: "additionalImages",
    title: "Additional images",
    description: "Other container images, such as tools or virtual machine disks. No OpenShift version needed."
  }
];

export const contentLabel = (content = {}) => {
  const picked = CONTENT_TYPES.filter((t) => content[t.key]).map((t) => t.title);
  return picked.length ? picked.join(" · ") : "No content selected yet";
};

/** Shown near the Operators heading when platform content is selected (owner wording, M3 acceptance). */
export const CATALOGS_FOLLOW_PLATFORM = "Operator catalogs follow the selected OpenShift platform minor.";

export const CATALOG_MINOR_HINT = `The OpenShift minor whose operator catalogs this profile mirrors from, for example ${EXAMPLE_MINOR}.

**What it controls:**
Red Hat publishes one Red Hat, one certified and one community operator catalog per OpenShift minor (index images tagged v${EXAMPLE_MINOR}, and so on). The packages, channels and versions you can choose come from the catalogs for this minor.

**When you see it:**
Only for profiles without OpenShift platform content. Choose the minor of the cluster that will run these operators. When a profile also mirrors the platform, there is no separate choice: the catalogs follow the platform release minor.

**Supported minors:**
Only minors this version of OpenShift Airgap Architect supports are offered. Nothing is chosen for you.

**Important notes:**
• Changing it keeps your selected operators as names and re-resolves them from the new minor's catalogs; anything not found there stays listed as not resolved and is left out of the generated file.
• ⚠️ A matching minor is not proof that an operator supports that OpenShift release. Check each operator's supported OpenShift versions.
• Low side: catalogs are scanned on the connected side. The disconnected side receives only what you mirror.`;

export const OPERATOR_SCAN_PULL_SECRET_HINT = `A Red Hat pull secret used once, to read the operator catalog index images for this scan.

**When needed:**
Only when the server has no registry credential mounted (REGISTRY_AUTH_FILE). If one is mounted, this field is not shown.

**How it's handled:**
Sent with the scan request only. It is not saved in the profile, not written to the server's state and not exported.

**Where to get it:**
console.redhat.com → OpenShift → Downloads → Pull secret.

**Example:**
{"auths":{"registry.redhat.io":{"auth":"…"}}}

**Important notes:**
• ⚠️ Paste it again for each scan in a new session; it is deliberately kept in memory only.
• This scan credential is separate from any credential the Install workflow uses.`;

export const ADDITIONAL_IMAGE_HINT = `One container image to mirror, as a full reference.

**Format:**
registry/repository/name followed by a :tag or an @sha256: digest.

**Examples:**
quay.io/myorg/app:v1.2.3
registry.example.com/tools/debug@sha256:0123…

**Why it matters:**
Each row becomes one entry under mirror.additionalImages in the ImageSetConfiguration. oc-mirror copies it to disk on the connected (low) side and pushes it to your disconnected registry on the high side.

**Important notes:**
• A digest pins exact content; a tag can move between mirror runs.
• ⚠️ Private registries need credentials at run time; they are not stored here.
• No OpenShift version is needed for additional images.`;

export const RELEASE_LOCK_NOTE = "Locking holds this profile's release steady while you build the rest of the profile: Update Service refreshes cannot change it, and the generated platform content uses exactly this release. It does not stop or cancel operator catalog scans; those are managed in the Operators section.";

export const IMPORT_FILES_HINT = `One or more existing oc-mirror v2 ImageSetConfiguration files (.yaml or .yml) to turn into Mirroring profiles.

**What happens:**
Each file is checked against the oc-mirror v2 ImageSetConfiguration schema this tool ships (the same check the Install workflow uses). Valid content is mapped into a profile: the OpenShift release, Red Hat / certified / community operators with their channels and version limits, additional images and the archive size. The original file is stored unchanged next to the profile, with its SHA-256.

**What is never done:**
• Nothing is invented: a package without a channel gets no channel until the scanned catalogs supply one.
• Unsupported OpenShift minors are reported, not replaced.
• oc-mirror is not run, and no registry is contacted.

**Limits:**
Up to 10 files, 1 MiB each. One YAML document per file (oc-mirror ignores any further documents). oc-mirror v1 files (apiVersion v1alpha2, storageConfig) are not accepted.

**Important notes:**
• ⚠️ Parts the editor cannot represent (several release channels, custom catalogs, targetRepo, Helm charts, blocked images) are listed for review rather than changed. Each must be left out explicitly before the profile can be generated; the original keeps them.
• Valid structure is not proof that a catalog, package or channel exists. That is checked separately against live catalogs.
• Example: an imageset-config.yaml exported from another Architect installation, or one written by hand for oc-mirror --v2.`;

export const IMPORT_MODE_HINT = `How the chosen files become profiles.

**One profile per file:**
The default. Files never affect each other.

**Merge into one new profile:**
Combines the files. Where they disagree (different OpenShift releases or catalog minors, the same package with different channels or version limits, different archive sizes) you choose which file wins before anything is imported. Identical images are listed once.

**Add to the open profile:**
Adds the files' content to the profile you have open. Images and operators you typed or edited stay exactly as they are; a disagreement is a choice, never an overwrite.

**Example:**
Two teams' files for the same disconnected site: merge them to see where they differ.`;

// ---------------------------------------------------------------------------
// M5 — run options, credentials, catalog check, run
// ---------------------------------------------------------------------------

export const ARCHIVE_SIZE_HINT = `Largest size, in GiB, of each archive file oc-mirror writes (archiveSize in the ImageSetConfiguration).

**Why it matters:**
A mirror can be hundreds of GiB. Splitting it into files no bigger than your transfer medium (a USB drive, a DVD, an upload limit) lets you carry it across the air gap in pieces.

**Format:**
A whole number of at least 1. Leave it empty for oc-mirror's own default.

**Example:**
4 for media formatted with a 4 GiB file limit (FAT32); 50 for large drives.

**Important notes:**
• It is written into this profile's ImageSetConfiguration, so the preview shows it.
• ⚠️ An archive can still exceed the size when a single image is larger, unless strict archiving is used, which makes the run fail instead.`;

export const RETRY_TIMES_HINT = `How many times oc-mirror retries a failed image or layer copy before giving up (0–10).

**Default:**
Empty uses oc-mirror's own default, 5.

**When to raise it:**
Unstable links or busy registries that throttle requests.

**When to lower it:**
0 makes the first error final, which is useful only while diagnosing a problem.

**Example:**
8 for a flaky VPN link.`;

export const RETRY_DELAY_HINT = `Fixed wait between retries, as a duration.

**Default:**
Empty lets oc-mirror back off exponentially, which suits most links.

**Format:**
A number and a unit: s, m or h (also ms, us, ns). For example 5s, 30s or 2m.

**When to set it:**
Registries with strict rate limits, where a steady pause works better than quick first retries.

**Example:**
10s against a registry that returns HTTP 429.`;

export const IMAGE_TIMEOUT_HINT = `Longest time oc-mirror waits for one image to copy before it counts as failed.

**Default:**
Empty uses oc-mirror's own default.

**Format:**
A number and a unit: s, m or h. For example 10m, 30m or 1h.

**When to raise it:**
Very large images (AI/ML runtimes, virtual machine disks) on slow links.

**Important notes:**
• The limit is per image, not for the whole run, and it covers all of that image's retries together (oc-mirror starts the clock once per image).
• ⚠️ Too short turns slow-but-working copies into failures.`;

export const LOG_LEVEL_HINT = `How much oc-mirror writes to the run log.

**info:**
Progress and important messages. Right for normal runs.

**debug:**
Every registry request and decision. Use it to diagnose a failing run.

**Important notes:**
• ⚠️ debug logs can be very large on big mirrors.
• Credentials are never written to the log by Architect; the log is oc-mirror's own output.`;

export const SINCE_HINT = `Mirror only content published on or after this date (mirror to disk only).

**Format:**
A date as yyyy-MM-dd, which is the format oc-mirror documents. For example 2026-01-31.

**Default:**
Empty: oc-mirror mirrors what is new since this profile's previous mirror-to-disk run, using the history it keeps in this profile's workspace.

**When to set it:**
To rebuild a smaller update archive from a known date, for example after the earlier archive was lost.

**Important notes:**
• ⚠️ Content published before the date is left out of this archive even if the disconnected side never received it.
• It is not a way to retry images that failed: run mirror to disk again with the same content for that; oc-mirror skips what it already has.`;

export const FULL_TRANSFER_DESCRIPTION = "Normally each mirror to disk writes only what changed since the previous one, so the disconnected side must load every transfer, in order. A full transfer contains everything in this profile: load it on its own to start over, or to repair a disconnected side that missed a transfer. It is larger and takes longer.";

export const DRY_RUN_DESCRIPTION = "Checks the configuration and lists what would be mirrored (working-dir/dry-run/mapping.txt and missing.txt in this profile's archive directory) without copying any image.";

export const RUN_PULL_SECRET_HINT = `Your Red Hat pull secret, used to pull OpenShift and operator content from registry.redhat.io for this run.

**How it is used:**
Written to a temporary file readable only by the server process (in memory where the host allows), passed to oc-mirror with --authfile, and deleted when the run (and any automatic signature retry) finishes. It is never saved in the profile, the plan, the job history or the browser.

**Only a user name and password?**
Help me generate builds the credentials for a private registry from its address, user name and password or token, and can keep the Red Hat pull secret next to it.

**Where to get it:**
console.redhat.com/openshift/install/pull-secret (Red Hat login required).

**Mounted secret:**
If the container has a pull secret mounted, you can use that instead and paste nothing.

**Additional images only:**
A profile without OpenShift platform or operator content needs no Red Hat credentials. Leave it empty for registries that allow anonymous pulls, or paste credentials for the registries your images come from.

**Important notes:**
• Add credentials for any other registry your additional images come from to the same JSON.
• ⚠️ The pull secret is a credential. Do not paste it into names or other fields.`;

export const CATALOG_CHECK_HINT = `Asks the live operator catalogs whether each selected package and channel exists, and which versions fall within any minimum/maximum you set.

**How it works:**
Architect downloads each catalog itself over HTTPS: the registry certificate is verified against the container's trust (the same trust oc-mirror uses) and every downloaded file against its SHA-256 digest. The pull secret below is used only for that download. oc-mirror's own catalog listing (the same engine as the catalog scan) then reads that verified copy locally, and each result records the catalog digest it was checked against.

**Results:**
• Verified: package and channel exist (and versions fall within your range).
• Not found: the catalog does not contain the package or channel. The run is blocked until you change the selection or check again.
• No version in range: the catalog lists versions, but none within your minimum/maximum.
• Not verified: the catalog could not be reached, did not answer, refused the credentials, or presented a certificate that could not be verified (then nothing, including the pull secret, is sent to it). Nothing is assumed.

**On a machine without internet access:**
The check cannot reach the catalogs and reports "Not verified". Verify on a connected machine before mirroring.

**Example:**
A package selected on channel stable-2.4 that the catalog has since renamed to stable-2.5 is reported as "Channel not found", with the channels the catalog does list.

**Important notes:**
• ⚠️ A result describes the catalog at the time of the check; catalogs change over time.
• Changing an operator's range after a check makes its result stale.`;

// ---------------------------------------------------------------------------
// M6 — workflows, transfer, disconnected side
// ---------------------------------------------------------------------------

export const WORKFLOW_HINT = `Which oc-mirror workflow this run uses. Across an air gap there are four steps; only two of them are oc-mirror runs.

**Mirror to disk (connected side, oc-mirror):**
Downloads the images from the source registries and writes them into archive files (mirror_000001.tar …) in this profile's archive directory.

**Prepare transfer (connected side, not a mirror run):**
Packages and documents those archive files for the trip: a checksum list, the exact configuration that was run and where it came from. The archives plus these files are the transfer.

**Receive transfer (disconnected side, not a mirror run):**
Identifies the transfer you carried across and verifies every file against the checksum list before anything can use it.

**Disk to mirror (disconnected side, oc-mirror):**
Uploads the verified archive contents into your registry, with exactly the configuration recorded on the connected side — nothing is regenerated from the profile.

**Mirror to mirror (oc-mirror, when one machine reaches both):**
Copies straight from the source registries into your registry. No archive files, no transfer.

**Example:**
Connected side: mirror to disk, then Prepare transfer. Copy the files to a USB drive and carry them across. Disconnected side: Receive transfer (name the folder you copied them into), then disk to mirror.

**Important notes:**
• ⚠️ A workflow that is not available says why under its card.`;

export const REGISTRY_URL_HINT = `The registry oc-mirror pushes into, as host[:port][/path].

**Examples:**
mirror.example.com:8443 · mirror.example.com:8443/ocp (a path prefix keeps several mirrors apart)

**Certificates:**
oc-mirror verifies the registry's certificate against the container's trust: the system store, SSL_CERT_FILE / SSL_CERT_DIR, and /etc/containers/certs.d/<host[:port]>/ca.crt. A registry signed by your own CA needs that CA in one of them; the preflight shows what is configured.

**Important notes:**
• Saved with the profile; credentials are not.
• ⚠️ The disconnected side's network confinement allows exactly this host, so name the host oc-mirror really connects to.`;

export const MIRROR_SECRET_HINT = `Credentials for the registry oc-mirror pushes into, as a pull-secret JSON ({"auths":{"<host[:port]>":{"auth":"<base64 user:password>"}}}).

**How it is used:**
Written to a temporary file readable only by the server process, passed with --authfile and deleted when the run finishes. Never saved in the profile, its plans, transfers or history.

**Only a user name and password?**
Help me generate builds it from the registry address, user name and password or token — no base64 by hand.

**Mirror to mirror:**
Combined with the source credentials above for this run only. A registry named in both with different values is refused, so it is always clear which account is used.

**Example:**
{"auths":{"mirror.example.com:8443":{"auth":"…"}}}

**Important notes:**
• ⚠️ The account needs push rights on the destination path.`;

export const TRANSFER_DIR_HINT = `The folder on this server where you copied the transfer — the files you carried across the air gap.

**What should be in the folder:**
• one or more mirror_000001.tar, mirror_000002.tar … files (the downloaded content)
• a file named SHA256SUMS (the checksum list)
• a folder named oaa-transfer (instructions and the exact configuration used)
All three side by side, exactly as Prepare transfer left them on the connected side.

**Where the folder can be:**
Under the server's data directory (in the container this is usually /data) or under /tmp. If the transfer is on a USB drive or file share, mount or copy it there first, for example to /data/transfer/site-a.

**What happens when you click Verify and receive:**
Architect checks that every file is there, complete and unchanged (size and SHA-256 against the list made on the connected side). Only if everything checks out are the files copied into the profile. Your copy on the drive is left untouched.

**Example:**
/data/transfer/site-a-2026-10-27

**Important notes:**
• ⚠️ One transfer per folder; files from another run in the same folder are refused.
• If something is missing or damaged, each problem is listed with how to fix it (usually: copy that file again).`;

export const RECEIVE_PLANNED_TITLE = "Receive a transfer with this same Architect";
export const RECEIVE_PLANNED_EXPLANATION = [
  "Most setups never need this. Normally the connected side and the disconnected side each have their own Architect, and the transfer is received on the disconnected one (Receive transfer… on its Mirroring page). This dialog is only for the case where this same Architect installation travels across the air gap — for example a laptop, or a server that is physically moved.",
  "How mirroring across an air gap works:",
  "1. Connected side: run Mirror to disk. It downloads the images into archive files.",
  "2. Click Prepare transfer on that run. It packages and documents the archive files for the trip: a checksum list, the exact configuration that was run and where it came from. The archives plus these files are the transfer — what you carry across the air gap (USB drive, DVD, file share). A transfer is not another mirror run.",
  "3. Copy the transfer to the disconnected side.",
  "4. Disconnected side: receive the transfer — tell Architect the folder you copied it into. Architect identifies the transfer and verifies that every file arrived complete and unchanged.",
  "5. Run Disk to mirror. It uploads the verified archive contents into your registry. Disk to mirror can only load a transfer that has been received, which is why it is not available yet.",
  "Here, step 4 receives the transfer into this profile on this same machine, after which Disk to mirror becomes available on it. The files are checked and copied, so the receiving folder needs as much free space as the transfer."
];
export const RECEIVE_SAME_SERVER_PREFILL = "This profile has a prepared transfer on this server. Use it as the folder to receive from (it is checked and copied exactly like a transfer from a drive).";
export const RECEIVE_RECEIVED_EXPLANATION = "When the connected side sends an updated transfer for this profile (for example next month's updates), receive it here: name the folder you copied it into. Every file is checked, then Disk to mirror offers it in its list of received transfers.";

export const ISOLATE_NETWORK_DESCRIPTION = "Recommended on the disconnected side. oc-mirror may reach only the destination registry and local addresses; any other request fails at once instead of trying a source registry and waiting for its timeouts.";

export const PREPARE_TRANSFER_DESCRIPTION = "Turns this run's archive files into a transfer — the set of files you carry across the air gap. It adds a checksum list (SHA256SUMS) and an oaa-transfer folder with instructions and the exact configuration, so the disconnected side can check that everything arrived complete. Then copy mirror_*.tar, SHA256SUMS and oaa-transfer/ to your drive or share. No password or pull secret is included.";

export const STORAGE_HINT = `Where this profile's mirroring content is written on the server: archive files, oc-mirror's workspace (with its incremental history) and cache, received transfers and each run's plan.

**Choosing it:**
Type any directory the server can write, as in Install's Run oc-mirror step, or pick a suggested volume. Usually that is a disk mounted into the server's container. You can change it until the profile writes anything; after its first run, transfer or import it stays put, so its history and cache are never split or moved.

**Container path, not host path:**
With -v /data/mirror:/mnt/mirror-data:Z the server sees /mnt/mirror-data — use that. /data/mirror exists only on the host.

**Example:**
/mnt/mirror-data (a missing last folder, such as /mnt/mirror-data/site-a, is created).

**Important notes:**
• ⚠️ Checked as the server's own user: a real directory (not a link), writable, not a system or application directory, not inside another profile.
• A mirror can need hundreds of GiB; the free space is shown and the preflight warns when it is low.`;

export const AIR_GAP_STEPS = [
  { key: "m2d", title: "Mirror to disk", detail: "download the images into archive files" },
  { key: "prepare", title: "Prepare transfer", detail: "package the archives with checksums, the exact configuration and where it came from" },
  { key: "carry", title: "Carry the files across", detail: "drive, DVD or file share" },
  { key: "receive", title: "Receive transfer", detail: "identify the transfer and verify every file" },
  { key: "d2m", title: "Disk to mirror", detail: "upload the verified archives into your registry" }
];

export const OPERATIONS_HINT = `Everything the Mirroring workflow ran on this server, newest first.

**What is listed:**
• oc-mirror runs — mirror to disk, disk to mirror, mirror to mirror, dry runs and automatic signature retries
• Prepare transfer and Receive transfer (these check and copy files; they do not run oc-mirror)
• catalog scans (Scan catalogs in Operators) — one entry per catalog (Red Hat, Certified, Community): which operators the catalogs for the chosen minor contain. A scan lists catalogs; it copies no images and has no oc-mirror command or archive
• live catalog checks (Check catalogs) — whether each selected operator's package and channel exist in the live catalogs

**What each entry shows:**
The profile, the workflow and content, where it read from and wrote to, the oc-mirror command (the credentials file is never shown), the oc-mirror binary's version and SHA-256, the plan and configuration SHA-256, the elapsed time, the outcome with the real failure details, and the output. Related entries are linked: a mirror to disk, the transfer prepared from it, its receipt, and the disk to mirror that used it.

**Example:**
Choose "Profile A" to see only its runs; open the newest mirror to disk to follow it live or stop it.

**Important notes:**
• ⚠️ Output and results come from the server's job history; a run that the server no longer remembers (for example after its history was cleared) shows as not known. Scans run before v2.2.0 recorded their profile, or on another Architect server, are not listed.
• The downloaded log contains no pull-secret values or credential paths.`;

export const BULK_IMAGES_HINT = `A list of container images to add in one go, one per line.

**Accepted formats (mix freely):**
• plain lines: quay.io/org/app:v1.2.3
• YAML list items: - quay.io/org/app:v1.2.3
• ImageSetConfiguration entries: - name: quay.io/org/app:v1.2.3
• quotes around the image and # comments are fine

**What is ignored:**
Other YAML lines such as additionalImages:, mirror: or apiVersion: … — they are counted and shown, never guessed at. In a whole ImageSetConfiguration, only additionalImages entries are taken: entries under blockedImages, delete, operators, platform or helm are reported by section and never added.

**What happens:**
Before anything changes you see how many images will be added, which are already in the profile (skipped) and which lines are not valid images (with the reason). Only valid, new images are added; you can then edit or remove any of them as usual.

**Example:**
A file images.yaml containing
  additionalImages:
    - name: quay.io/org/app:v1.2.3
    - name: registry.example.com/tools/debug:2.0
adds two images and reports one ignored YAML line.

**Important notes:**
• Each image needs a :tag or an @sha256: digest.
• A profile holds at most 500 additional images.`;

export const RETRY_VS_UPDATE_HINT = `Two different things that both start oc-mirror again.

**Run the same again (this button):**
Finishes an unfinished run. It uses exactly the configuration and options that run used — byte for byte, even if you changed the profile since — and the same workspace and cache, so oc-mirror fetches only what is still missing. For a mirror to disk it produces the archive that run should have produced.

**A new mirror to disk (incremental update):**
Starts the next cycle from the profile as it is now: new or updated operators and images. It writes only what changed since the last complete run, and the disconnected side loads it after the previous transfer.

**Example:**
Three images failed with "503 Service Unavailable": run the same again. You added an operator: run a new mirror to disk.

**Important notes:**
• ⚠️ Credentials are asked for again; they are never kept from the first attempt.
• Offered only when the failure is one a retry can fix (temporary errors, a stop, or credentials and certificates you have fixed). Images that no longer exist at the source need a change to the profile instead.`;

export const RECOVERY_CLASS_TEXT = {
  RETRY_SAME: "Can be run again",
  RESUME_PRESERVED_STATE: "Stopped before it finished",
  REPAIR_AUTH_OR_TRUST: "Fix credentials or certificates, then run again",
  REQUIRE_OWNER_ACTION: "Needs a decision",
  REQUIRE_NEW_LOW_SIDE_TRANSFER: "Needs the transfer again",
  UNSUPPORTED_OR_UNKNOWN: "Cause not recognised"
};

export const VERIFICATION_STATE_TEXT = {
  "fully-verified": "Fully verified",
  "partially-verified": "Partly verified",
  incomplete: "Incomplete",
  unverifiable: "Could not be verified"
};

