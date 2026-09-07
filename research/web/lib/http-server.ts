import { Server, type IncomingMessage, type RequestListener } from "node:http";
import type { Duplex } from "node:stream";
import { checkRequest, type SessionConfig } from "./security";

export function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const part of value) headers.append(key, part);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

export function hasProxyHeaders(headers: Headers): boolean {
  return ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port"].some(key => headers.has(key));
}

/** Gate upgrade dispatch itself; a prepended listener cannot stop Next's listener. */
export class ResearchHttpServer extends Server {
  constructor(private readonly session: SessionConfig, private readonly development: boolean, listener: RequestListener) {
    super({ maxHeaderSize: 8192 }, listener);
  }

  override emit(event: string, ...args: unknown[]): boolean {
    if (event === "upgrade") {
      const [req, socket] = args as [IncomingMessage, Duplex, Buffer];
      const headers = requestHeaders(req);
      let pathname = "";
      try { pathname = new URL(req.url ?? "", this.session.origin).pathname; } catch { /* reject below */ }
      const denied = !this.development || req.method !== "GET" || pathname !== "/_next/webpack-hmr"
        || hasProxyHeaders(headers) || headers.get("origin") !== this.session.origin
        || checkRequest({ method: req.method, pathname, headers }, this.session) !== null;
      if (denied) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n");
        return true;
      }
    }
    return super.emit(event, ...args);
  }
}
