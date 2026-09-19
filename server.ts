import express from "express";
import * as http from "http";
import * as https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { createServer as createViteServer } from "vite";

const PROVIDER_USER_AGENT = process.env.PROVIDER_USER_AGENT || "IPTVSmartersPlayer/3.0.0";
const PROVIDER_REFERER = process.env.PROVIDER_REFERER || "";
const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN || "";
const ALLOWED_IPTV_HOSTS = process.env.ALLOWED_IPTV_HOSTS
  ? process.env.ALLOWED_IPTV_HOSTS.split(",").map((host) => host.trim().toLowerCase())
  : [];
const PORT = Number(process.env.PORT || 8080);
const HLS_ROOT = path.join(os.tmpdir(), `iptv-player-hls-${PORT}`);

type StopFn = (reason: string) => void;

async function startServer() {
  const app = express();
  const active = new Map<string, { playback: string; stop: StopFn }>();
  const bridgeInputs = new Map<string, { url: string; headers: Record<string, string> }>();

  app.use(express.json());
  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Playback-Session, X-Playback-Id, X-HLS-Mode, ETag"
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const cleanId = (value: unknown) =>
    typeof value === "string" ? value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120) : "";

  const identity = (req: express.Request) => ({
    session: cleanId(req.query.session),
    playback: cleanId(req.query.playback),
  });

  const hlsDir = (session: string, playback: string) => path.join(HLS_ROOT, session, playback);

  const removePathSoon = (target: string, delay = 800) => {
    setTimeout(() => {
      void fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
    }, delay);
  };

  const stopActive = (session: string, playback: string | undefined, reason: string) => {
    if (!session) return false;
    const current = active.get(session);
    if (!current) return false;
    if (playback && current.playback !== playback) {
      console.log(`Ignoring stale stop session=${session} playback=${playback}; active=${current.playback}`);
      return false;
    }
    active.delete(session);
    console.log(`Stopping HLS session=${session} playback=${current.playback}: ${reason}`);
    try { current.stop(reason); } catch {}
    return true;
  };

  const register = (session: string, playback: string, stop: StopFn) => {
    if (!session) return;
    stopActive(session, undefined, "superseded by new playback");
    active.set(session, { playback, stop });
    console.log(`Registered HLS session=${session} playback=${playback}`);
  };

  const clearActive = (session: string, playback: string) => {
    if (session && active.get(session)?.playback === playback) active.delete(session);
  };

  function getClientIp(req: express.Request) {
    const xff = String(req.headers["x-forwarded-for"] || "");
    if (xff) return xff.split(",")[0].trim();
    return String(req.headers["x-real-ip"] || req.socket.remoteAddress || "").trim();
  }

  function upstreamHeaders(req: express.Request, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "identity",
      ...extra,
    };
    const ua = String(req.query.ua || PROVIDER_USER_AGENT || "");
    const referer = String(req.query.referer || PROVIDER_REFERER || "");
    const origin = String(req.query.origin || PROVIDER_ORIGIN || "");
    if (ua) headers["User-Agent"] = ua;
    if (referer) headers.Referer = referer;
    if (origin) headers.Origin = origin;
    const ip = getClientIp(req);
    if (ip) {
      headers["X-Forwarded-For"] = ip;
      headers["X-Real-IP"] = ip;
      headers["Client-IP"] = ip;
    }
    return headers;
  }

  type OpenedUpstream = {
    response: http.IncomingMessage;
    request: http.ClientRequest;
    finalUrl: string;
  };

  function headerValue(response: http.IncomingMessage, name: string) {
    const value = response.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] || null;
    return value == null ? null : String(value);
  }

  function openUpstream(
    urlString: string,
    method: string,
    headers: Record<string, string>,
    redirects = 0
  ): Promise<OpenedUpstream> {
    if (redirects > 6) return Promise.reject(new Error("Too many upstream redirects"));

    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(urlString);
      } catch (error) {
        reject(error);
        return;
      }

      const client = parsed.protocol === "https:" ? https : http;
      const request = client.request(parsed, { method, headers }, (response) => {
        const status = response.statusCode || 0;
        const location = headerValue(response, "location");
        if (location && [301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          const nextUrl = new URL(location, parsed).toString();
          const nextMethod = status === 303 && method !== "HEAD" ? "GET" : method;
          openUpstream(nextUrl, nextMethod, headers, redirects + 1).then(resolve, reject);
          return;
        }
        resolve({ response, request, finalUrl: parsed.toString() });
      });

      request.setTimeout(120000, () => {
        request.destroy(new Error("Upstream media request timed out"));
      });
      request.on("error", reject);
      request.end();
    });
  }

  async function readStreamText(stream: http.IncomingMessage, maxBytes = 8 * 1024 * 1024) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new Error("Upstream manifest exceeded size limit");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  function validate(urlString: string) {
    if (!urlString) return "Missing URL";
    let parsed: URL;
    try { parsed = new URL(urlString); } catch { return "Malformed URL"; }
    if (!/^https?:$/.test(parsed.protocol)) return "Only HTTP/HTTPS URLs are allowed";
    const host = parsed.hostname.toLowerCase();
    const privateHost =
      host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" ||
      host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith(".local") || host.endsWith(".internal");
    if (privateHost) return "Private hosts are forbidden";
    if (
      ALLOWED_IPTV_HOSTS.length &&
      !ALLOWED_IPTV_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    ) return `Host '${host}' is not allowed`;
    return "";
  }

  function contentType(raw: string | null, fallback: string) {
    const value = (raw || "").toLowerCase();
    if (value.includes("mpegurl") || value.includes("m3u8")) return "application/vnd.apple.mpegurl";
    if (value.includes("mp2t")) return "video/mp2t";
    if (value.includes("mp4")) return "video/mp4";
    if (value.includes("matroska") || value.includes("mkv")) return "video/x-matroska";
    if (value.includes("webm")) return "video/webm";
    if (value.includes("json")) return "application/json; charset=utf-8";
    if (value.includes("html")) return "text/html; charset=utf-8";
    return fallback;
  }

  function proxyUrl(url: string, req: express.Request) {
    const params = new URLSearchParams({ url });
    for (const key of ["ua", "referer", "origin"]) {
      const value = req.query[key];
      if (typeof value === "string" && value) params.set(key, value);
    }
    return `/api/xtream/stream?${params.toString()}`;
  }

  function rewriteM3u8(text: string, base: string, req: express.Request) {
    return text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#EXT")) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          try { return `URI="${proxyUrl(new URL(uri, base).toString(), req)}"`; }
          catch { return match; }
        });
      }
      if (!trimmed.startsWith("#")) {
        try { return proxyUrl(new URL(trimmed, base).toString(), req); } catch {}
      }
      return line;
    }).join("\n");
  }

  function isProviderHls(urlString: string) {
    try {
      const parsed = new URL(urlString);
      return /\.m3u8$/i.test(parsed.pathname) || /(?:^|[?&])type=m3u_plus(?:&|$)/i.test(urlString);
    } catch {
      return false;
    }
  }

  const hlsTranscodeArgs = () => [
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "superfast", "-tune", "zerolatency",
    "-profile:v", "main", "-level:v", "4.1", "-pix_fmt", "yuv420p",
    "-bf", "0", "-refs", "1", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-avoid_negative_ts", "make_zero",
  ];

  function ffmpegProviderInputArgs(req: express.Request, url: string, start: number) {
    const headers = upstreamHeaders(req);
    const ffmpegHeaders = Object.entries(headers)
      .filter(([key]) => !["user-agent", "referer", "host"].includes(key.toLowerCase()))
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");

    return [
      ...(start > 0 ? ["-ss", String(start)] : []),
      "-user_agent", headers["User-Agent"] || PROVIDER_USER_AGENT,
      ...(headers.Referer ? ["-referer", headers.Referer] : []),
      ...(ffmpegHeaders ? ["-headers", `${ffmpegHeaders}\r\n`] : []),
      "-rw_timeout", "120000000",
      "-i", url,
    ];
  }

  async function waitForPlaylist(file: string, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const text = await fs.promises.readFile(file, "utf8");
        if (text.includes("#EXTINF:")) return text;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return "";
  }

  app.all("/api/internal/hls-input/:token", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(405).send("Method Not Allowed");
    }

    const remote = String(req.socket.remoteAddress || "");
    const loopback =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "::ffff:127.0.0.1";
    if (!loopback) return res.status(403).send("Loopback only");

    const input = bridgeInputs.get(String(req.params.token || ""));
    if (!input) return res.status(404).send("Expired HLS input");

    try {
      const headers: Record<string, string> = { ...input.headers };
      if (typeof req.headers.range === "string") headers.Range = req.headers.range;

      const opened = await openUpstream(input.url, req.method, headers);
      const upstream = opened.response;
      const status = upstream.statusCode || 502;

      if (status >= 400) {
        upstream.resume();
        return res.status(status).send(`Upstream bridge error: ${status}`);
      }

      const responseHeaders: Record<string, string> = {
        "Content-Type": contentType(headerValue(upstream, "content-type"), "application/octet-stream"),
        "Accept-Ranges": headerValue(upstream, "accept-ranges") || "bytes",
        "Cache-Control": "no-store",
      };
      for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
        const value = headerValue(upstream, key);
        if (value) responseHeaders[key] = value;
      }

      res.writeHead(status, responseHeaders);
      if (req.method === "HEAD") {
        upstream.resume();
        return res.end();
      }

      upstream.on("error", (error) => {
        console.warn(`HLS input upstream stream error token=${req.params.token}: ${error.message}`);
        if (!res.writableEnded) res.end();
      });
      res.on("close", () => {
        try { upstream.destroy(); } catch {}
        try { opened.request.destroy(); } catch {}
      });
      return upstream.pipe(res);
    } catch (error: any) {
      console.warn(`HLS input bridge core-http error token=${req.params.token}: ${error?.message || error}`);
      if (!res.headersSent) return res.status(502).send("HLS input bridge failed");
    }
  });

  async function startGeneratedHls(
    url: string,
    req: express.Request,
    session: string,
    playback: string,
    start: number
  ) {
    if (!ffmpegPath) throw new Error("FFmpeg is unavailable");
    if (active.get(session)?.playback === playback) return;

    stopActive(session, undefined, "new playback for same player session");
    const sessionRoot = path.join(HLS_ROOT, session);
    await fs.promises.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});
    const dir = hlsDir(session, playback);
    await fs.promises.mkdir(dir, { recursive: true });

    const playlist = path.join(dir, "index.m3u8");
    const segmentPattern = path.join(dir, "segment-%06d.ts");
    const outputArgs = [
      ...hlsTranscodeArgs(),
      "-f", "hls",
      "-hls_time", "2",
      "-hls_list_size", "0",
      "-hls_playlist_type", "event",
      "-hls_flags", "independent_segments+temp_file",
      "-hls_segment_filename", segmentPattern,
      playlist,
    ];

    let stopped = false;
    let stderr = "";
    let bridgeToken = "";
    let readable: http.IncomingMessage | null = null;
    let upstreamRequest: http.ClientRequest | null = null;

    let ffmpeg;
    if (start > 0) {
      bridgeToken = `${session}--${playback}`;
      bridgeInputs.set(bridgeToken, {
        url,
        headers: upstreamHeaders(req),
      });

      const bridgeUrl =
        `http://127.0.0.1:${PORT}/api/internal/hls-input/${encodeURIComponent(bridgeToken)}`;
      const args = [
        "-hide_banner", "-loglevel", "info", "-nostdin",
        "-ss", String(start),
        "-i", bridgeUrl,
        ...outputArgs,
      ];

      console.log(
        `Starting instant-seek HLS via core-http range bridge session=${session} playback=${playback} start=${start}s source=${url}`
      );
      ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    } else {
      console.log(
        `Opening provider media with Node core HTTP session=${session} playback=${playback} url=${url}`
      );
      const opened = await openUpstream(url, "GET", upstreamHeaders(req));
      readable = opened.response;
      upstreamRequest = opened.request;
      const status = readable.statusCode || 502;

      if (status >= 400) {
        readable.resume();
        throw new Error(`Provider media request failed with HTTP ${status}`);
      }

      console.log(
        `Provider core-http response status=${status} type=${headerValue(readable, "content-type") || "unknown"} length=${headerValue(readable, "content-length") || "unknown"} finalUrl=${opened.finalUrl}`
      );

      const args = [
        "-hide_banner", "-loglevel", "info", "-nostdin",
        "-i", "pipe:0",
        ...outputArgs,
      ];
      console.log(
        `Starting generated HLS from core-http pipe session=${session} playback=${playback} source=${opened.finalUrl}`
      );
      ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });

      readable.on("error", (error: any) => {
        if (!stopped) {
          console.warn(
            `Provider core-http stream error session=${session} playback=${playback}: ${error?.message || error}`
          );
        }
        try { ffmpeg.stdin.destroy(error); } catch {}
      });
      ffmpeg.stdin.on("error", (error: any) => {
        if (!stopped && error?.code !== "EPIPE") {
          console.warn(
            `FFmpeg HLS stdin error session=${session} playback=${playback}: ${error?.message || error}`
          );
        }
      });
      readable.pipe(ffmpeg.stdin);
    }

    const stop: StopFn = (reason) => {
      if (stopped) return;
      stopped = true;
      console.log(`Generated HLS stop session=${session} playback=${playback}: ${reason}`);
      if (bridgeToken) bridgeInputs.delete(bridgeToken);
      try { readable?.destroy(); } catch {}
      try { upstreamRequest?.destroy(); } catch {}
      try { ffmpeg.stdin?.destroy(); } catch {}
      try { if (!ffmpeg.killed) ffmpeg.kill("SIGKILL"); } catch {}
      removePathSoon(dir);
    };

    register(session, playback, stop);

    ffmpeg.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-8000);
      console.log(`FFmpeg HLS: ${text.trimEnd()}`);
    });

    ffmpeg.on("error", (error) => {
      if (bridgeToken) bridgeInputs.delete(bridgeToken);
      try { readable?.destroy(); } catch {}
      try { upstreamRequest?.destroy(); } catch {}
      console.warn(
        `FFmpeg HLS spawn error session=${session} playback=${playback}: ${error.message}`
      );
      clearActive(session, playback);
    });

    ffmpeg.on("close", (code, signal) => {
      if (bridgeToken) bridgeInputs.delete(bridgeToken);
      try { readable?.destroy(); } catch {}
      try { upstreamRequest?.destroy(); } catch {}
      clearActive(session, playback);
      console.log(
        `FFmpeg HLS exited code=${code} signal=${signal || "none"} stopped=${stopped} session=${session} playback=${playback}; ${stderr.trim().slice(-1800) || "no diagnostics"}`
      );
      if (!stopped) removePathSoon(dir, 5 * 60 * 1000);
    });
  }

  app.get("/api/xtream/hls/:session/:playback/index.m3u8", async (req, res) => {
    try {
      const session = cleanId(req.params.session);
      const playback = cleanId(req.params.playback);
      if (!session || !playback || session !== req.params.session || playback !== req.params.playback) {
        return res.status(400).send("Invalid playback identity");
      }

      const url = String(req.query.url || "");
      const error = validate(url);
      if (error) return res.status(400).send(error);

      if (isProviderHls(url)) {
        const upstream = await fetch(url, {
          headers: upstreamHeaders(req),
          redirect: "follow",
          signal: AbortSignal.timeout(120000),
        });
        if (!upstream.ok) return res.status(upstream.status).send(`Upstream HLS error: ${upstream.status}`);
        const body = rewriteM3u8(await upstream.text(), upstream.url || url, req);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("X-HLS-Mode", "provider-passthrough");
        res.setHeader("X-Playback-Session", session);
        res.setHeader("X-Playback-Id", playback);
        return res.send(body);
      }

      const requestedStart = Number(req.query.start);
      const start = Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;
      const playlist = path.join(hlsDir(session, playback), "index.m3u8");

      let text = "";
      try { text = await fs.promises.readFile(playlist, "utf8"); } catch {}
      if (!text.includes("#EXTINF:")) {
        await startGeneratedHls(url, req, session, playback, start);
        text = await waitForPlaylist(playlist);
      }
      if (!text) {
        stopActive(session, playback, "HLS playlist startup timeout");
        return res.status(504).send("Timed out waiting for the first HLS segment");
      }

      console.log(`Serving generated HLS manifest session=${session} playback=${playback} start=${start}s`);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("X-HLS-Mode", "generated");
      res.setHeader("X-Playback-Session", session);
      res.setHeader("X-Playback-Id", playback);
      return res.send(text);
    } catch (error: any) {
      console.error("HLS manifest error:", error.stack || error);
      if (!res.headersSent) res.status(500).send(error.message || "HLS manifest error");
    }
  });

  app.get("/api/xtream/hls/:session/:playback/:segment", async (req, res) => {
    const session = cleanId(req.params.session);
    const playback = cleanId(req.params.playback);
    const segment = String(req.params.segment || "");
    if (!session || !playback || session !== req.params.session || playback !== req.params.playback) {
      return res.status(400).end();
    }
    if (!/^segment-\d{6}\.ts$/.test(segment)) return res.status(404).end();
    const file = path.join(hlsDir(session, playback), segment);
    try { await fs.promises.access(file, fs.constants.R_OK); }
    catch { return res.status(404).end(); }
    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.sendFile(file);
  });

  app.post("/api/xtream/stop", (req, res) => {
    const { session, playback } = identity(req);
    if (!session) return res.status(400).json({ error: "Missing session" });
    const stopped = stopActive(session, playback || undefined, "explicit player stop");
    if (!stopped && playback) removePathSoon(hlsDir(session, playback), 0);
    return res.json({ stopped, session, playback: playback || null });
  });

  app.get("/api/xtream/proxy", async (req, res) => {
    try {
      const url = String(req.query.url || "");
      const error = validate(url);
      if (error) return res.status(400).json({ error });
      const upstream = await fetch(url, {
        headers: upstreamHeaders(req),
        redirect: "follow",
        signal: AbortSignal.timeout(120000),
      });
      res.writeHead(upstream.status, {
        "Content-Type": contentType(upstream.headers.get("content-type"), "application/json; charset=utf-8"),
      });
      if (!upstream.body) return res.end();
      return Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (error: any) {
      if (!res.headersSent) {
        return res.status(502).json({ error: "Failed to connect to IPTV server", details: error.message });
      }
    }
  });

  app.all("/api/xtream/stream", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).send("Method Not Allowed");
    try {
      const url = String(req.query.url || "");
      const error = validate(url);
      if (error) return res.status(400).send(error);

      const extraHeaders: Record<string, string> = {};
      if (typeof req.headers.range === "string") extraHeaders.Range = req.headers.range;

      const opened = await openUpstream(url, req.method, upstreamHeaders(req, extraHeaders));
      const upstream = opened.response;
      const status = upstream.statusCode || 502;

      if (status >= 400) {
        upstream.resume();
        return res.status(status).send(`Upstream stream error: ${status}`);
      }

      const lower = opened.finalUrl.toLowerCase();
      const upstreamType = contentType(headerValue(upstream, "content-type"), "");
      const isM3u8 = lower.includes(".m3u8") || upstreamType.includes("mpegurl");
      if (isM3u8 && req.method === "GET") {
        const body = rewriteM3u8(await readStreamText(upstream), opened.finalUrl, req);
        res.writeHead(status, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-cache,no-store",
        });
        return res.end(body);
      }

      const type = contentType(
        headerValue(upstream, "content-type"),
        lower.includes(".ts") ? "video/mp2t" :
        lower.includes(".mp4") ? "video/mp4" :
        lower.includes(".mkv") ? "video/x-matroska" :
        lower.includes(".webm") ? "video/webm" :
        "application/octet-stream"
      );
      const responseHeaders: Record<string, string> = {
        "Content-Type": type,
        "Accept-Ranges": headerValue(upstream, "accept-ranges") || "bytes",
      };
      for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
        const value = headerValue(upstream, key);
        if (value) responseHeaders[key] = value;
      }

      res.writeHead(status, responseHeaders);
      if (req.method === "HEAD") {
        upstream.resume();
        return res.end();
      }

      upstream.on("error", (streamError) => {
        console.warn(`Core HTTP stream pipe notice: ${streamError.message}`);
        if (!res.writableEnded) res.end();
      });
      res.on("close", () => {
        try { upstream.destroy(); } catch {}
        try { opened.request.destroy(); } catch {}
      });
      return upstream.pipe(res);
    } catch (error: any) {
      console.error("Proxy stream core-http error:", error.stack || error);
      if (!res.headersSent) return res.status(502).send(`Upstream stream proxy error: ${error.message || error}`);
    }
  });

  app.get("/api/health", (_req, res) => res.json({
    status: "ok",
    device: "webos-iptv-player",
    playbackTransport: "hls",
    ffmpegAvailable: !!ffmpegPath,
    activeTranscodes: active.size,
    hlsRoot: HLS_ROOT,
    upstreamUserAgent: PROVIDER_USER_AGENT,
  }));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () =>
    console.log(`WebOS Xtream IPTV server running on http://0.0.0.0:${PORT} (universal HLS playback)`)
  );
}

startServer();
