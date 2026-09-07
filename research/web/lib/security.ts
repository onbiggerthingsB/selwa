import { timingSafeEqual } from "node:crypto";

export interface SessionConfig { authority: string; origin: string; secret: string; cookieName: string }
export interface GateRequest { method: string; pathname: string; headers: Headers }
export interface GateFailure { status: number; code: string; message: string }

export function sessionConfig(port: number, secret: string): SessionConfig {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || secret.length !== 64 || !/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error("Invalid local research session configuration");
  }
  const authority = `127.0.0.1:${port}`;
  return { authority, origin: `http://${authority}`, secret, cookieName: `ht_research_session_${port}` };
}

export function sessionFromEnvironment(): SessionConfig | null {
  try {
    const port = process.env.HT_RESEARCH_PORT;
    if (!port || !/^\d{4,5}$/.test(port)) return null;
    return sessionConfig(Number(port), process.env.HT_RESEARCH_SESSION ?? "");
  } catch { return null; }
}

export function sessionCookie(config: SessionConfig): string {
  return `${config.cookieName}=${config.secret}; Path=/; HttpOnly; SameSite=Strict`;
}

function authenticated(headers: Headers, config: SessionConfig): boolean {
  const matches = (headers.get("cookie") ?? "").split(";").map(part => part.trim())
    .filter(part => part.split("=", 1)[0] === config.cookieName);
  if (matches.length !== 1) return false;
  const value = matches[0].slice(config.cookieName.length + 1);
  if (value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(config.secret));
}

export function checkRequest(request: GateRequest, config: SessionConfig, requireSession = true): GateFailure | null {
  const deny = (code: string, message: string): GateFailure => ({ status: 403, code, message });
  if (request.headers.get("host") !== config.authority) {
    return deny("local_host_required", "Open this research session at its local address.");
  }
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== config.origin) || (request.method === "POST" && origin !== config.origin)) {
    return deny("local_origin_required", "This request must come from the local research page.");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && !["same-origin", "none"].includes(site)) {
    return deny("local_origin_required", "This request must come from the local research page.");
  }
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return { status: 405, code: "method_not_allowed", message: "This request method is not supported." };
  }
  if (requireSession && !authenticated(request.headers, config)) {
    return { status: 401, code: "session_required", message: "Reopen the local research page to start a session." };
  }
  return null;
}

export function errorResponse(failure: GateFailure): Response {
  return Response.json({ error: { code: failure.code, message: failure.message } }, {
    status: failure.status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function authorizeApiRequest(request: Request): Response | null {
  const config = sessionFromEnvironment();
  if (!config) return errorResponse({ status: 503, code: "launcher_required", message: "Start this private app with its research launcher." });
  const url = new URL(request.url);
  // NextRequest normalizes loopback IPs to localhost in request.url. The actual
  // inbound Host and browser Origin still have to match 127.0.0.1 exactly below.
  const normalizedOrigin = config.origin.replace("127.0.0.1", "localhost");
  if (url.origin !== config.origin && url.origin !== normalizedOrigin) {
    return errorResponse({ status: 403, code: "local_host_required", message: "Open this research session at its local address." });
  }
  const failure = checkRequest({ method: request.method, pathname: url.pathname, headers: request.headers }, config);
  return failure ? errorResponse(failure) : null;
}
