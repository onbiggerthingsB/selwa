import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeApiRequest, checkRequest, sessionConfig, sessionCookie } from "../lib/security";
import { NextRequest } from "next/server";

const config = sessionConfig(38471, "a".repeat(64));
const cookie = `${config.cookieName}=${config.secret}`;
function headers(extra: Record<string, string> = {}) {
  return new Headers({ host: config.authority, origin: config.origin, cookie, "sec-fetch-site": "same-origin", ...extra });
}
afterEach(() => vi.unstubAllEnvs());
describe("launcher-issued loopback session", () => {
  it("permits the exact session without exposing a browser-readable token", () => {
    expect(checkRequest({ method: "POST", pathname: "/api/chat", headers: headers() }, config)).toBeNull();
    expect(sessionCookie(config)).toContain("HttpOnly; SameSite=Strict");
    expect(sessionCookie(config)).not.toContain("Domain=");
  });
  it.each(["localhost:38471", "127.0.0.1:38472", "attacker.example", "127.0.0.1:38471, attacker.example"])("rejects substituted host %s", host => {
    expect(checkRequest({ method: "GET", pathname: "/", headers: headers({ host }) }, config, false)?.status).toBe(403);
  });
  it.each(["null", "https://attacker.example", "http://127.0.0.1:38472", "http://localhost:38471"])("rejects an untrusted origin %s", origin => {
    expect(checkRequest({ method: "POST", pathname: "/api/chat", headers: headers({ origin }) }, config)?.status).toBe(403);
  });
  it("rejects missing POST origin, same-site cross-port fetch and cross-site navigation", () => {
    const missing = headers(); missing.delete("origin");
    expect(checkRequest({ method: "POST", pathname: "/api/chat", headers: missing }, config)?.status).toBe(403);
    for (const site of ["cross-site", "same-site"]) {
      expect(checkRequest({ method: "GET", pathname: "/", headers: headers({ "sec-fetch-site": site }) }, config, false)?.status).toBe(403);
    }
  });
  it.each(["", `${config.cookieName}=${"b".repeat(64)}`, `${cookie}; ${cookie}`, `${cookie}=extra`])("rejects missing, invalid or duplicate cookie", value => {
    expect(checkRequest({ method: "POST", pathname: "/api/chat", headers: headers({ cookie: value }) }, config)?.status).toBe(401);
  });
  it("allows a direct document bootstrap but never unauthenticated API access", () => {
    const direct = new Headers({ host: config.authority });
    expect(checkRequest({ method: "GET", pathname: "/", headers: direct }, config, false)).toBeNull();
    expect(checkRequest({ method: "GET", pathname: "/api/catalog", headers: direct }, config)?.status).toBe(401);
  });
  it("keeps direct next start API calls disabled", async () => {
    vi.stubEnv("HT_RESEARCH_PORT", ""); vi.stubEnv("HT_RESEARCH_SESSION", "");
    const response = authorizeApiRequest(new Request(`${config.origin}/api/catalog`, { headers: headers() }));
    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
  it("validates the API URL and restarts invalidate an earlier credential", () => {
    vi.stubEnv("HT_RESEARCH_PORT", "38471"); vi.stubEnv("HT_RESEARCH_SESSION", "a".repeat(64));
    expect(authorizeApiRequest(new Request(`${config.origin}/api/catalog`, { headers: headers() }))).toBeNull();
    expect(authorizeApiRequest(new Request("http://attacker.example/api/catalog", { headers: headers() }))?.status).toBe(403);
    vi.stubEnv("HT_RESEARCH_SESSION", "b".repeat(64));
    expect(authorizeApiRequest(new Request(`${config.origin}/api/catalog`, { headers: headers() }))?.status).toBe(401);
  });
  it("accepts NextRequest's normalized URL while still checking actual Host and Origin", () => {
    vi.stubEnv("HT_RESEARCH_PORT", "38471"); vi.stubEnv("HT_RESEARCH_SESSION", "a".repeat(64));
    const request = new NextRequest(`${config.origin}/api/catalog`, { headers: headers() });
    expect(new URL(request.url).hostname).toBe("localhost");
    expect(authorizeApiRequest(request)).toBeNull();
    expect(authorizeApiRequest(new NextRequest(`${config.origin}/api/catalog`, { headers: headers({ host: "localhost:38471" }) }))?.status).toBe(403);
  });
  it("rejects newline-terminated credentials rather than passing unequal buffers to timingSafeEqual", () => {
    expect(() => sessionConfig(38471, "a".repeat(64) + "\n")).toThrow();
    expect(checkRequest({ method: "GET", pathname: "/api/catalog", headers: headers({ cookie: cookie + "=extra" }) }, config)?.status).toBe(401);
  });
});
