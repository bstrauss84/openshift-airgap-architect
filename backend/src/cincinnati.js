/** Cincinnati release channels and patch versions; cached in SQLite. MOCK_MODE uses bundled YAML. */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { getCache, setCache } from "./utils.js";

const CHANNELS_CACHE_KEY = "cincinnati_channels_v1";
const PATCH_CACHE_PREFIX = "cincinnati_patches_v1:";

const isMock = () => String(process.env.MOCK_MODE).toLowerCase() === "true";

const mockPath = (file) => path.join(process.cwd(), "mock-data", file);

const stableFileRegex = /^stable-(\d+)\.(\d+)\.ya?ml$/;

const sortVersionsDesc = (versions) =>
  versions.sort((a, b) => {
    const [amj, ami, ap] = a.split(".").map(Number);
    const [bmj, bmi, bp] = b.split(".").map(Number);
    if (amj !== bmj) return bmj - amj;
    if (ami !== bmi) return bmi - ami;
    return bp - ap;
  });

const fetchChannelsFromGithub = async () => {
  const res = await fetch("https://api.github.com/repos/openshift/cincinnati-graph-data/contents/channels", {
    headers: { "User-Agent": "airgap-architect" }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch channels directory: ${res.status}`);
  }
  const data = await res.json();
  const channels = data
    .filter((item) => stableFileRegex.test(item.name))
    .map((item) => item.name.replace(/\.ya?ml$/, ""))
    .map((name) => name.replace("stable-", ""))
    .sort((a, b) => {
      const [amj, ami] = a.split(".").map(Number);
      const [bmj, bmi] = b.split(".").map(Number);
      if (amj !== bmj) return bmj - amj;
      return bmi - ami;
    });
  return channels;
};

const fetchChannels = async (force = false) => {
  if (isMock()) {
    const mock = JSON.parse(fs.readFileSync(mockPath("channels.json"), "utf8"));
    return mock.channels || [];
  }
  if (!force) {
    const cached = getCache(CHANNELS_CACHE_KEY);
    if (cached) return cached.value;
  }
  const channels = await fetchChannelsFromGithub();
  setCache(CHANNELS_CACHE_KEY, channels);
  return channels;
};

const fetchStableFile = async (channel) => {
  if (isMock()) {
    const mock = JSON.parse(fs.readFileSync(mockPath(`stable-${channel}.json`), "utf8"));
    return mock.versions;
  }
  const url = `https://raw.githubusercontent.com/openshift/cincinnati-graph-data/master/channels/stable-${channel}.yaml`;
  const res = await fetch(url, { headers: { "User-Agent": "airgap-architect" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch stable-${channel}.yaml: ${res.status}`);
  }
  const text = await res.text();
  const parsed = yaml.load(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.versions)) return parsed.versions;
  return [];
};

const fetchPatchesForChannel = async (channel, force = false) => {
  const cacheKey = `${PATCH_CACHE_PREFIX}${channel}`;
  if (isMock()) {
    const mock = JSON.parse(fs.readFileSync(mockPath(`stable-${channel}.json`), "utf8"));
    return mock.versions;
  }
  if (!force) {
    const cached = getCache(cacheKey);
    if (cached) return cached.value;
  }
  const versions = await fetchStableFile(channel);
  const filtered = versions
    .map((v) => String(v).trim())
    .filter((v) => v.startsWith(`${channel}.`));
  const sorted = sortVersionsDesc(filtered);
  setCache(cacheKey, sorted);
  return sorted;
};

export { fetchChannels, fetchPatchesForChannel };
