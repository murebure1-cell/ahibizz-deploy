import { createServer, request as httpRequest } from "node:http";
import { Transform } from "node:stream";
import {
  inspectIngressRequest,
  internalClientIpHeader,
  isValidatedIngressPolicy,
  normalizeIngressIp,
} from "./ingress-policy.mjs";

function withoutHopHeaders(headers) {
  const excluded = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    ...(typeof headers.connection === "string"
      ? headers.connection.split(",").map((key) => key.trim().toLowerCase())
      : []),
  ]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)));
}

function forwardedHeaders(request, policy, clientIp) {
  const headers = withoutHopHeaders(request.headers);
  for (const name of Object.keys(headers))
    if (
      name.startsWith("x-ahibizz-ingress-") ||
      name.startsWith("x-forwarded-") ||
      name === "forwarded" ||
      name === "x-real-ip"
    )
      delete headers[name];
  const origin = new URL(policy.origin);
  headers.host = origin.host;
  headers["x-forwarded-host"] = origin.host;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-port"] = origin.port || "443";
  if (clientIp && policy.trustClientIp) headers[internalClientIpHeader] = clientIp;
  return headers;
}

function reject(request, response, status) {
  if (response.destroyed) return;
  if (!response.headersSent) {
    response.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "close",
    });
    response.end(status === 413 ? "Request too large." : "Gateway request unavailable.");
    request.resume();
  } else response.destroy();
}

/** Candidate transport only. It neither listens nor spawns Next or changes authentication. */
export function createIngressForwarder({
  policy,
  maxBodyBytes = 32 * 1024 * 1024,
  upstreamTimeoutMs = 120_000,
} = {}) {
  if (!isValidatedIngressPolicy(policy)) throw new Error("A validated ingress policy is required.");
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 64 * 1024 * 1024)
    throw new Error("Invalid ingress body bound.");
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 10 || upstreamTimeoutMs > 300_000)
    throw new Error("Invalid ingress timeout.");
  const sockets = new Set();
  const server = createServer({ maxHeaderSize: 16_384 }, (request, response) => {
    response.on("error", () => request.destroy());
    let decision;
    try {
      decision = inspectIngressRequest(request, policy);
    } catch {
      reject(request, response, 503);
      return;
    }
    if (!decision.allowed) return reject(request, response, decision.status);
    if (request.method === "TRACE") return reject(request, response, 405);
    const length = request.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBodyBytes))
      return reject(request, response, 413);
    let bodyBytes = 0;
    let failed = false;
    let upstream;
    try {
      upstream = httpRequest({
        host: policy.internalHost,
        port: policy.internalPort,
        path: request.url,
        method: request.method,
        headers: forwardedHeaders(request, policy, decision.clientIp),
        agent: false,
      });
    } catch {
      return reject(request, response, 502);
    }
    const connectionDeadline = setTimeout(() => fail(504), Math.min(upstreamTimeoutMs, 5000));
    connectionDeadline.unref();
    const fail = (status) => {
      if (failed) return;
      failed = true;
      clearTimeout(connectionDeadline);
      upstream.destroy();
      reject(request, response, status);
    };
    upstream.setTimeout(upstreamTimeoutMs, () => fail(504));
    upstream.once("socket", (socket) => {
      if (!socket.connecting) clearTimeout(connectionDeadline);
      else socket.once("connect", () => clearTimeout(connectionDeadline));
    });
    upstream.on("error", () => fail(502));
    upstream.on("response", (incoming) => {
      if (failed) return incoming.destroy();
      clearTimeout(connectionDeadline);
      response.writeHead(incoming.statusCode ?? 502, withoutHopHeaders(incoming.headers));
      incoming.on("error", () => fail(502));
      incoming.pipe(response);
      response.once("close", () => {
        if (!response.writableFinished) incoming.destroy();
      });
    });
    const bounded = new Transform({
      transform(chunk, _encoding, callback) {
        bodyBytes += chunk.length;
        if (bodyBytes > maxBodyBytes) callback(new Error("Ingress request body limit."));
        else callback(null, chunk);
      },
    });
    bounded.on("error", () => {
      request.unpipe(bounded);
      bounded.unpipe(upstream);
      fail(413);
    });
    request.once("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.once("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(bounded).pipe(upstream);
  });
  server.headersTimeout = 60_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const denyTunnel = (_request, socket) => {
    const peer = normalizeIngressIp(socket.remoteAddress);
    const trusted = peer && policy.peers.includes(peer);
    socket.end(
      `HTTP/1.1 ${trusted ? "405 Method Not Allowed" : "403 Forbidden"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.setTimeout(1000, () => socket.destroy());
  };
  server.on("upgrade", denyTunnel);
  server.on("connect", denyTunnel);
  return {
    server,
    close(graceMs = 10_000) {
      if (!Number.isInteger(graceMs) || graceMs < 0 || graceMs > 30_000)
        throw new Error("Invalid shutdown grace period.");
      return new Promise((resolve, rejectClose) => {
        const timer = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
          server.closeAllConnections();
        }, graceMs);
        timer.unref();
        server.close((error) => {
          clearTimeout(timer);
          if (error) rejectClose(error);
          else resolve();
        });
      });
    },
  };
}
