import { type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import next from "next";
import { checkRequest, sessionConfig, sessionCookie } from "../lib/security";
import { hasProxyHeaders, requestHeaders, ResearchHttpServer } from "../lib/http-server";

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const portIndex = args.indexOf("--port");
const portText = portIndex < 0 ? "38471" : args[portIndex + 1];
const allowed = args.filter((_, i) => i !== portIndex && (portIndex < 0 || i !== portIndex + 1));
if (allowed.some(arg => arg !== "--dev") || !portText || !/^\d{4,5}$/.test(portText)) {
  throw new Error("Usage: npm run start -- [--port 38471], or npm run dev -- [--port 38471]");
}
const port = Number(portText);
const config = sessionConfig(port, randomBytes(32).toString("hex"));
process.env.HT_RESEARCH_PORT = String(port);
process.env.HT_RESEARCH_SESSION = config.secret;
process.env.NEXT_TELEMETRY_DISABLED = "1";
const dir = fileURLToPath(new URL("..", import.meta.url));
const app = next({ dev, dir, hostname: "127.0.0.1", port });
await app.prepare();
const handle = app.getRequestHandler();

function reject(res: ServerResponse, status: number, code: string, message: string) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Connection": "close" });
  res.end(JSON.stringify({ error: { code, message } }));
}
const server = new ResearchHttpServer(config, dev, async (req, res) => {
  const headers = requestHeaders(req);
  // The launcher is the sole edge: it is not configured behind a proxy.
  if (hasProxyHeaders(headers)) {
    reject(res, 403, "proxy_not_supported", "Use the research app's local address directly."); return;
  }
  let pathname: string;
  try { pathname = new URL(req.url ?? "/", config.origin).pathname; }
  catch { reject(res, 400, "invalid_request", "The request could not be read."); return; }
  const failure = checkRequest({ method: req.method ?? "", pathname, headers }, config, pathname.startsWith("/api/"));
  if (failure) { reject(res, failure.status, failure.code, failure.message); return; }
  if (req.method === "GET" && pathname === "/") res.setHeader("Set-Cookie", sessionCookie(config));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // Keep Next's static-asset cache defaults from overriding the research policy.
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: string | number | readonly string[]) => setHeader(name,
    name.toLowerCase() === "cache-control" ? "no-store" : value)) as typeof res.setHeader;
  try { await handle(req, res); }
  catch {
    if (!res.headersSent) reject(res, 500, "runtime_failure", "The local request could not complete.");
    else res.destroy();
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 1000;
server.maxRequestsPerSocket = 100;
server.maxConnections = 16;
server.on("error", () => { console.error("The research server could not bind its loopback port. It has stopped."); process.exitCode = 1; void app.close(); });
await new Promise<void>((resolve, rejectListen) => { server.once("error", rejectListen); server.listen(port, "127.0.0.1", resolve); });
console.log(`Private research demo: ${config.origin} (synthetic responses; no model connected)`);

let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => { server.closeAllConnections(); void app.close().finally(() => process.exit(0)); }, 2000);
  deadline.unref();
  server.close(() => { clearTimeout(deadline); void app.close().finally(() => process.exit(0)); });
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
