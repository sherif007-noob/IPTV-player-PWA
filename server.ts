import express from "express";
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
const HLS_ROOT = path.join(os.tmpdir(), "iptv-player-hls");

type StopFn = (reason: string) => void;

async function startServer() {
  const app = express();
  const PORT = 3000;
  const active = new Map<string, { playback: string; stop: StopFn }>();

  app.use(express.json());
  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Stream-Error, X-Stream-Start, X-Stream-Transcoded, X-Playback-Session, X-Playback-Id, ETag"
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

  const hlsDir = (session: string, playback: string) =>
    path.join(HLS_ROOT, session, playback);

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
      console.log(
        `Ignoring stale stop session=${session} playback=${playback}; active=${current.playback}`
      );
      return false;
    }
    active.delete(session);
    console.log(`Stopping transcode session=${session} playback=${current.playback}: ${reason}`);
    try { current.stop(reason); } catch {}
    return true;
  };

  const register = (session: string, playback: string, stop: StopFn) => {
    if (!session) return;
    stopActive(session, undefined, "superseded by new playback");
    active.set(session, { playback, stop });
    console.log(`Registered transcode session=${session} playback=${playback || "none"}`);
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

  function mp4Fallback(urlString: string) {
    try {
      const parsed = new URL(urlString);
      if (!/\.mkv$/i.test(parsed.pathname)) return null;
      parsed.pathname = parsed.pathname.replace(/\.mkv$/i, ".mp4");
      return parsed.toString();
    } catch { return null; }
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

  const commonVideoArgs = () => [
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "superfast", "-tune", "zerolatency",
    "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p",
    "-bf", "0", "-refs", "1", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-avoid_negative_ts", "make_zero",
  ];

  const mp4OutputArgs = () => [
    ...commonVideoArgs(),
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-flush_packets", "1", "-f", "mp4", "pipe:1",
  ];

  async function waitForPlaylist(file: string, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const text = await fs.promises.readFile(file, "utf8");
        if (text.includes("#EXTINF:")) return text;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return "";
  }

  async function startHlsTranscode(
    url: string,
    req: express.Request,
    session: string,
    playback: string,
    start: number
  ) {
    if (!ffmpegPath) throw new Error("FFmpeg is unavailable");
    const existing = active.get(session);
    if (existing?.playback === playback) return;

    stopActive(session, undefined, "new HLS playback for same player session");
    const sessionRoot = path.join(HLS_ROOT, session);
    await fs.promises.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});
    const dir = hlsDir(session, playback);
    await fs.promises.mkdir(dir, { recursive: true });

    const headers = upstreamHeaders(req);
    const ffmpegHeaders = Object.entries(headers)
      .filter(([key]) => !["user-agent", "referer", "host"].includes(key.toLowerCase()))
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    const playlist = path.join(dir, "index.m3u8");
    const segmentPattern = path.join(dir, "segment-%06d.ts");
    const args = [
      "-hide_banner", "-loglevel", "info", "-nostdin",
      "-re",
      ...(start > 0 ? ["-ss", String(start)] : []),
      "-user_agent", headers["User-Agent"] || PROVIDER_USER_AGENT,
      ...(headers.Referer ? ["-referer", headers.Referer] : []),
      ...(ffmpegHeaders ? ["-headers", `${ffmpegHeaders}\r\n`] : []),
      "-rw_timeout", "120000000",
      "-i", url,
      ...commonVideoArgs(),
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "6",
      "-hls_delete_threshold", "2",
      "-hls_flags", "delete_segments+independent_segments+temp_file",
      "-hls_segment_filename", segmentPattern,
      playlist,
    ];

    console.log(
      `Starting HLS MKV transcode session=${session} playback=${playback} start=${start}s inputUrl=${url}`
    );
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stopped = false;
    let stderr = "";

    const stop: StopFn = (reason) => {
      if (stopped) return;
      stopped = true;
      console.log(`HLS FFmpeg stop session=${session} playback=${playback}: ${reason}`);
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
      console.warn(`FFmpeg HLS spawn error session=${session} playback=${playback}: ${error.message}`);
      clearActive(session, playback);
    });
    ffmpeg.on("close", (code) => {
      clearActive(session, playback);
      console.log(
        `FFmpeg HLS exited code=${code} stopped=${stopped} session=${session} playback=${playback}; ${stderr.trim().slice(-1800) || "no diagnostics"}`
      );
      if (!stopped) removePathSoon(dir, 5 * 60 * 1000);
    });
  }

  function transcodeHeaders(res: express.Response, start: number, session: string, playback: string) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("X-Stream-Start", String(start));
    res.setHeader("X-Stream-Transcoded", "mkv-to-fragmented-mp4-fallback");
    if (session) res.setHeader("X-Playback-Session", session);
    if (playback) res.setHeader("X-Playback-Id", playback);
  }

  async function transcodeMkvFallback(
    url: string,
    req: express.Request,
    res: express.Response,
    start: number,
    session: string,
    playback: string
  ) {
    if (!ffmpegPath) return false;
    const headers = upstreamHeaders(req);
    const ffmpegHeaders = Object.entries(headers)
      .filter(([key]) => !["user-agent", "referer", "host"].includes(key.toLowerCase()))
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    const args = [
      "-hide_banner", "-loglevel", "info", "-nostdin",
      ...(start > 0 ? ["-ss", String(start)] : []),
      "-user_agent", headers["User-Agent"] || PROVIDER_USER_AGENT,
      ...(headers.Referer ? ["-referer", headers.Referer] : []),
      ...(ffmpegHeaders ? ["-headers", `${ffmpegHeaders}\r\n`] : []),
      "-rw_timeout", "120000000", "-i", url,
      ...mp4OutputArgs(),
    ];
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stopped = false;
    const stop: StopFn = (reason) => {
      if (stopped) return;
      stopped = true;
      console.log(`Fallback FFmpeg stop session=${session || "none"} playback=${playback || "none"}: ${reason}`);
      try { if (!ffmpeg.killed) ffmpeg.kill("SIGKILL"); } catch {}
      try { ffmpeg.stdout.destroy(); } catch {}
      if (!res.writableEnded && !res.destroyed) try { res.end(); } catch {}
    };
    register(session, playback, stop);
    transcodeHeaders(res, start, session, playback);
    ffmpeg.stderr.on("data", (chunk) => console.log(`FFmpeg MKV fallback: ${chunk.toString().trimEnd()}`));
    ffmpeg.on("close", () => clearActive(session, playback));
    ffmpeg.stdout.pipe(res);
    res.on("close", () => { clearActive(session, playback); stop("client response closed"); });
    res.on("error", () => { clearActive(session, playback); stop("client response error"); });
    return true;
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
      if (!/\.mkv$/i.test(new URL(url).pathname)) return res.status(400).send("HLS transcoding requires an MKV source");
      const requestedStart = Number(req.query.start);
      const start = Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;
      const playlist = path.join(hlsDir(session, playback), "index.m3u8");

      let text = "";
      try { text = await fs.promises.readFile(playlist, "utf8"); } catch {}
      if (!text.includes("#EXTINF:")) {
        await startHlsTranscode(url, req, session, playback, start);
        text = await waitForPlaylist(playlist);
      }
      if (!text) {
        stopActive(session, playback, "HLS playlist startup timeout");
        return res.status(504).send("Timed out waiting for the first HLS segment");
      }

      console.log(`Serving HLS manifest session=${session} playback=${playback} start=${start}s`);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("X-Playback-Session", session);
      res.setHeader("X-Playback-Id", playback);
      res.send(text);
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
    res.sendFile(file);
  });

  app.post("/api/xtream/stop", (req, res) => {
    const { session, playback } = identity(req);
    if (!session) return res.status(400).json({ error: "Missing session" });
    const stopped = stopActive(session, playback || undefined, "explicit player stop");
    if (!stopped && playback) removePathSoon(hlsDir(session, playback), 0);
    res.json({ stopped, session, playback: playback || null });
  });

  app.get("/api/xtream/proxy", async (req, res) => {
    try {
      const url = String(req.query.url || "");
      const error = validate(url);
      if (error) return res.status(400).json({ error });
      const upstream = await fetch(url, {
        headers: upstreamHeaders(req), redirect: "follow", signal: AbortSignal.timeout(120000),
      });
      res.writeHead(upstream.status, {
        "Content-Type": contentType(upstream.headers.get("content-type"), "application/json; charset=utf-8"),
      });
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (error: any) {
      if (!res.headersSent) res.status(502).json({ error: "Failed to connect to IPTV server", details: error.message });
    }
  });

  app.all("/api/xtream/stream", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).send("Method Not Allowed");
    try {
      const url = String(req.query.url || "");
      const error = validate(url);
      if (error) return res.status(400).send(error);
      const { session, playback } = identity(req);
      const isMkv = (() => { try { return /\.mkv$/i.test(new URL(url).pathname); } catch { return false; } })();
      const requestedStart = Number(req.query.start);
      const start = isMkv && Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;

      const extraHeaders: Record<string, string> = {};
      if (!isMkv && typeof req.headers.range === "string") extraHeaders.Range = req.headers.range;

      const fallback = mp4Fallback(url);
      if (fallback) {
        const upstream = await fetch(fallback, {
          method: req.method, headers: upstreamHeaders(req, extraHeaders), redirect: "follow", signal: AbortSignal.timeout(120000),
        });
        if (upstream.ok) {
          const responseHeaders: Record<string, string> = {
            "Content-Type": contentType(upstream.headers.get("content-type"), "video/mp4"),
            "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
          };
          for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
            const value = upstream.headers.get(key); if (value) responseHeaders[key] = value;
          }
          res.writeHead(upstream.status, responseHeaders);
          if (req.method === "HEAD" || !upstream.body) return res.end();
          const readable = Readable.fromWeb(upstream.body as any);
          res.on("close", () => { try { readable.destroy(); } catch {} });
          return readable.pipe(res);
        }
        console.log(`MP4 variant unavailable (${upstream.status}); MKV fallback available: ${url}`);
      }

      if (isMkv) {
        if (req.method === "HEAD") {
          const upstream = await fetch(url, { method: "HEAD", headers: upstreamHeaders(req), redirect: "follow", signal: AbortSignal.timeout(120000) });
          if (!upstream.ok) return res.status(upstream.status).end();
          return res.writeHead(upstream.status, {
            "Content-Type": contentType(upstream.headers.get("content-type"), "video/x-matroska"),
            "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
          }).end();
        }
        if (session) stopActive(session, undefined, "new fallback MKV playback for same player session");
        if (await transcodeMkvFallback(url, req, res, start, session, playback)) return;
      }

      const upstream = await fetch(url, {
        method: req.method, headers: upstreamHeaders(req, extraHeaders), redirect: "follow", signal: AbortSignal.timeout(120000),
      });
      if (!upstream.ok && upstream.status >= 400) return res.status(upstream.status).send(`Upstream stream error: ${upstream.status}`);
      const lower = (upstream.url || url).toLowerCase();
      const isM3u8 = lower.includes(".m3u8") || lower.includes("type=m3u_plus");
      const type = contentType(
        upstream.headers.get("content-type"),
        isM3u8 ? "application/vnd.apple.mpegurl" : lower.includes(".ts") ? "video/mp2t" : lower.includes(".webm") ? "video/webm" : "video/mp4"
      );
      if ((isM3u8 || type.includes("mpegurl")) && req.method === "GET") {
        const body = rewriteM3u8(await upstream.text(), upstream.url || url, req);
        res.writeHead(upstream.status, {
          "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-cache,no-store",
        });
        return res.end(body);
      }
      const responseHeaders: Record<string, string> = {
        "Content-Type": type, "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      };
      for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
        const value = upstream.headers.get(key); if (value) responseHeaders[key] = value;
      }
      res.writeHead(upstream.status, responseHeaders);
      if (req.method === "HEAD" || !upstream.body) return res.end();
      const readable = Readable.fromWeb(upstream.body as any);
      res.on("close", () => { try { readable.destroy(); } catch {} });
      readable.pipe(res);
    } catch (error: any) {
      console.error("Proxy stream error:", error.stack || error);
      if (!res.headersSent) res.status(502).send(`Upstream stream proxy error: ${error.message || error}`);
    }
  });

  app.get("/api/health", (_req, res) => res.json({
    status: "ok",
    device: "webos-iptv-player",
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
    console.log(`WebOS Xtream IPTV server running on http://0.0.0.0:${PORT}`)
  );
}

startServer();
