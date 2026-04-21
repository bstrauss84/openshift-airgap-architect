import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const configureHref = pathToFileURL(join(backendRoot, "src", "configureFetchProxy.js")).href;

/** Isolated process: undici global dispatcher after configureFetchProxy import. */
function dispatcherNameAfterConfigure(extraEnv) {
  const code = `
import { getGlobalDispatcher } from "undici";
await import(${JSON.stringify(configureHref)});
console.log(getGlobalDispatcher().constructor.name);
`;
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--input-type=module", "-e", code], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        NODE_ENV: "test",
        ...extraEnv
      }
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || `exit ${code}`));
      else resolve(out.trim());
    });
  });
}

test("configureFetchProxy: installs EnvHttpProxyAgent by default", async () => {
  const name = await dispatcherNameAfterConfigure({});
  assert.strictEqual(name, "EnvHttpProxyAgent");
});

test("configureFetchProxy: AIRGAP_FETCH_USE_ENV_PROXY=false leaves default Agent", async () => {
  const name = await dispatcherNameAfterConfigure({ AIRGAP_FETCH_USE_ENV_PROXY: "false" });
  assert.strictEqual(name, "Agent");
});

test("configureFetchProxy: AIRGAP_FETCH_USE_ENV_PROXY=0 leaves default Agent", async () => {
  const name = await dispatcherNameAfterConfigure({ AIRGAP_FETCH_USE_ENV_PROXY: "0" });
  assert.strictEqual(name, "Agent");
});

test("configureFetchProxy: explicit true still uses EnvHttpProxyAgent", async () => {
  const name = await dispatcherNameAfterConfigure({ AIRGAP_FETCH_USE_ENV_PROXY: "true" });
  assert.strictEqual(name, "EnvHttpProxyAgent");
});
