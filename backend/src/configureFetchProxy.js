/**
 * Route global fetch() through HTTP_PROXY / HTTPS_PROXY / NO_PROXY (undici).
 * Opt out: AIRGAP_FETCH_USE_ENV_PROXY=false or 0.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const disabled =
  process.env.AIRGAP_FETCH_USE_ENV_PROXY === "false" ||
  process.env.AIRGAP_FETCH_USE_ENV_PROXY === "0";

if (!disabled) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
