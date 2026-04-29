/** Background Cincinnati refresh for Operations job visibility. */
import { fetchChannels, fetchPatchesForChannel } from "./cincinnati.js";
import { appendJobOutput, updateJob, updateJobMetadata } from "./utils.js";

function pickChannelForPatches(channels, preferred) {
  if (preferred && channels.includes(preferred)) return preferred;
  return channels.length ? channels[0] : null;
}

/**
 * Run full Cincinnati refresh (channels + patches for one channel). Updates job status/output.
 * @param {string} jobId
 * @param {{ preferredChannel?: string | null }} opts
 */
export async function runCincinnatiBackgroundJob(jobId, opts = {}) {
  const preferredChannel = opts.preferredChannel ?? null;
  try {
    appendJobOutput(jobId, "Fetching Cincinnati channels from upstream (GitHub)…\n");
    const channels = await fetchChannels(true);
    appendJobOutput(jobId, `Found ${channels.length} stable channel(s).\n`);
    updateJob(jobId, { progress: 35 });

    const ch = pickChannelForPatches(channels, preferredChannel);
    let patchCount = 0;
    if (ch) {
      appendJobOutput(jobId, `Fetching patch list for stable-${ch}…\n`);
      const versions = await fetchPatchesForChannel(ch, true);
      patchCount = versions.length;
      appendJobOutput(jobId, `Found ${patchCount} patch version(s).\n`);
    } else {
      appendJobOutput(jobId, "No channel available for patch list.\n");
    }

    updateJobMetadata(jobId, {
      cincinnatiRefresh: {
        channel: ch,
        channelCount: channels.length,
        patchCount
      }
    });
    updateJob(jobId, {
      status: "completed",
      progress: 100,
      message: `Cincinnati refresh completed (${channels.length} channels${ch ? `, ${patchCount} patches for ${ch}` : ""}).`
    });
  } catch (err) {
    const name = err?.name || "";
    const msg = String(err?.message || err);
    const hint =
      name === "TimeoutError" || /aborted|timeout/i.test(msg)
        ? " (Request timed out — check corporate HTTP proxy / TLS trust on the backend; see README “Corporate HTTP proxy and backend egress”.)\n"
        : "\n";
    appendJobOutput(jobId, `\nError: ${msg}${hint}`);
    updateJob(jobId, { status: "failed", progress: 100, message: msg });
  }
}
