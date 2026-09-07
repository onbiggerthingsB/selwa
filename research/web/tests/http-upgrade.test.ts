import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { ResearchHttpServer } from "../lib/http-server";
import { sessionConfig } from "../lib/security";

const config = sessionConfig(38471, "a".repeat(64));
function upgrade(dev: boolean, changes: Record<string, string | undefined> = {}, path = "/_next/webpack-hmr") {
  const server = new ResearchHttpServer(config, dev, () => {});
  const nextHandler = vi.fn(); server.on("upgrade", nextHandler);
  const request = new IncomingMessage(new Socket());
  request.method = "GET"; request.url = path;
  request.headers = { host: config.authority, origin: config.origin, cookie: `${config.cookieName}=${config.secret}`,
    "sec-fetch-site": "same-origin", ...changes };
  const socket = new PassThrough();
  let written = ""; socket.on("data", chunk => { written += chunk.toString(); });
  server.emit("upgrade", request, socket, Buffer.alloc(0));
  request.destroy(); socket.destroy(); server.close();
  return { handled: nextHandler.mock.calls.length, written };
}

it("blocks production upgrades before any automatically registered Next listener", () => {
  expect(upgrade(false)).toEqual({ handled: 0, written: expect.stringContaining("403 Forbidden") });
});
it.each([
  { origin: "http://127.0.0.1:8080", "sec-fetch-site": "same-site" },
  { origin: undefined }, { cookie: undefined }, { host: "localhost:38471" },
  { "x-forwarded-host": config.authority },
])("rejects untrusted development upgrades before dispatch: %j", changes => {
  expect(upgrade(true, changes)).toEqual({ handled: 0, written: expect.stringContaining("403 Forbidden") });
});
it("permits only the authenticated exact-origin development HMR path", () => {
  expect(upgrade(true)).toEqual({ handled: 1, written: "" });
  expect(upgrade(true, {}, "/api/chat").handled).toBe(0);
});
