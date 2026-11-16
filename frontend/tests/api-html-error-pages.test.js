/**
 * An HTML error page (a proxy, or a backend that does not know the route yet)
 * is never shown to the user as markup: apiFetch turns it into a sentence.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch } from "../src/api.js";

const page = '<!DOCTYPE html><html lang="en"><head><title>Error</title></head><body><pre>Cannot POST /api/x</pre></body></html>';
afterEach(() => vi.unstubAllGlobals());

describe("apiFetch error messages", () => {
  it("a 404 HTML page becomes a plain explanation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(page, { status: 404, statusText: "Not Found" }))));
    const err = await apiFetch("/api/x", { method: "POST" }).catch((e) => e);
    expect(err.message).toBe("The server does not offer this action (HTTP 404). If Architect was just updated, restart its backend.");
    expect(err.message).not.toMatch(/</);
  });
  it("other HTML pages name the status only; JSON errors are unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(page, { status: 502, statusText: "Bad Gateway" }))));
    expect((await apiFetch("/api/x").catch((e) => e)).message).toBe("The server answered HTTP 502 (Bad Gateway) without details.");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "Readable reason." }), { status: 409 }))));
    expect((await apiFetch("/api/x").catch((e) => e)).message).toBe("Readable reason.");
  });
});
