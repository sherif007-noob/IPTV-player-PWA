import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { spawn, spawnSync } from "child_process";
import ffmpegStaticPath from "ffmpeg-static";
import { createServer as createViteServer } from "vite";

const PROVIDER_USER_AGENT = process.env.PROVIDER_USER_AGENT || "IPTVSmartersPlayer/3.0.0";
const PROVIDER_REFERER = process.env.PROVIDER_REFERER || "";
const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN || "";
const ALLOWED_IPTV_HOSTS = process.env.ALLOWED_IPTV_HOSTS
  ? process.env.ALLOWED_IPTV_HOSTS.split(",").map((host) => host.trim().toLowerCase())
  : [];
const PORT = Number(process.env.PORT || 8080);
const HLS_ROOT = path.join(os.tmpdir(), `iptv-player-hls-${PORT}`);


function canRunExecutable(command: string) {
  try {
    const probe = spawnSync(command, ["-version"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true,
    });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
}

function resolveFfmpegExecutable() {
  const configured = String(process.env.FFMPEG_PATH || "").trim();
  if (configured && canRunExecutable(configured)) {
    return { path: configured, source: "FFMPEG_PATH" };
  }

  // Prefer the host FFmpeg build when available. It uses the OS networking/runtime
  // instead of the bundled static build and is generally the most compatible choice
  // for provider HTTP redirects on Linux desktops.
  if (canRunExecutable("ffmpeg")) {
    return { path: "ffmpeg", source: "system PATH" };
  }

  if (ffmpegStaticPath && canRunExecutable(ffmpegStaticPath)) {
    return { path: ffmpegStaticPath, source: "ffmpeg-static fallback" };
  }

  return { path: "", source: "unavailable" };
}

const FFMPEG = resolveFfmpegExecutable();


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

  function describeNetworkError(error: any) {
    const message = String(error?.message || error || "unknown error");
    const cause = error?.cause;
    if (!cause) return message;

    const details = [
      cause.code ? `code=${cause.code}` : "",
      cause.errno ? `errno=${cause.errno}` : "",
      cause.syscall ? `syscall=${cause.syscall}` : "",
      cause.address ? `address=${cause.address}` : "",
      cause.port ? `port=${cause.port}` : "",
      cause.message ? `message=${cause.message}` : "",
    ].filter(Boolean).join(" ");

    return details ? `${message} | cause: ${details}` : message;
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
    "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p",
    "-bf", "0", "-refs", "1", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-avoid_negative_ts", "make_zero",
  ];

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

      const upstream = await fetch(input.url, {
        method: req.method,
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(120000),
      });

      if (!upstream.ok && upstream.status >= 400) {
        return res.status(upstream.status).send(`Upstream bridge error: ${upstream.status}`);
      }

      const responseHeaders: Record<string, string> = {
        "Content-Type": contentType(upstream.headers.get("content-type"), "application/octet-stream"),
        "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
        "Cache-Control": "no-store",
      };
      for (const key of ["content-length", "content-range", "etag", "last-modified"]) {
        const value = upstream.headers.get(key);
        if (value) responseHeaders[key] = value;
      }

      res.writeHead(upstream.status, responseHeaders);
      if (req.method === "HEAD" || !upstream.body) return res.end();

      const readable = Readable.fromWeb(upstream.body as any);
      res.on("close", () => { try { readable.destroy(); } catch {} });
      return readable.pipe(res);
    } catch (error: any) {
      console.warn(`HLS input bridge error token=${req.params.token}: ${describeNetworkError(error)}`);
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
    if (!FFMPEG.path) throw new Error("FFmpeg is unavailable");
    if (active.get(session)?.playback === playback) return;

    stopActive(session, undefined, "new playback for same player session");
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
      ...hlsTranscodeArgs(),
      "-f", "hls",
      "-hls_time", "2",
      "-hls_list_size", "8",
      "-hls_delete_threshold", "3",
      "-hls_flags", "delete_segments+independent_segments+temp_file",
      "-hls_segment_filename", segmentPattern,
      playlist,
    ];

    console.log(`Starting generated HLS session=${session} playback=${playback} start=${start}s inputUrl=${url}`);
    const ffmpeg = spawn(FFMPEG.path, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stopped = false;
    let stderr = "";

    const stop: StopFn = (reason) => {
      if (stopped) return;
      stopped = true;
      console.log(`Generated HLS stop session=${session} playback=${playback}: ${reason}`);
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
    ffmpeg.on("close", (code, signal) => {
      clearActive(session, playback);
      console.log(
        `FFmpeg HLS exited code=${code} signal=${signal || "none"} stopped=${stopped} binary=${FFMPEG.source} session=${session} playback=${playback}; ${stderr.trim().slice(-1800) || "no diagnostics"}`
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
      const upstream = await fetch(url, {
        method: req.method,
        headers: upstreamHeaders(req, extraHeaders),
        redirect: "follow",
        signal: AbortSignal.timeout(120000),
      });
      if (!upstream.ok && upstream.status >= 400) {
        return res.status(upstream.status).send(`Upstream stream error: ${upstream.status}`);
      }

      const lower = (upstream.url || url).toLowerCase();
      const isM3u8 = lower.includes(".m3u8") || contentType(upstream.headers.get("content-type"), "").includes("mpegurl");
      if (isM3u8 && req.method === "GET") {
        const body = rewriteM3u8(await upstream.text(), upstream.url || url, req);
        res.writeHead(upstream.status, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Content-Length": Buffer.byteLength(body),
          "Cache-Control": "no-cache,no-store",
        });
        return res.end(body);
      }

      const type = contentType(
        upstream.headers.get("content-type"),
        lower.includes(".ts") ? "video/mp2t" : lower.includes(".webm") ? "video/webm" : "application/octet-stream"
      );
      const responseHeaders: Record<string, string> = {
        "Content-Type": type,
        "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      };
      for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
        const value = upstream.headers.get(key);
        if (value) responseHeaders[key] = value;
      }
      res.writeHead(upstream.status, responseHeaders);
      if (req.method === "HEAD" || !upstream.body) return res.end();
      const readable = Readable.fromWeb(upstream.body as any);
      res.on("close", () => { try { readable.destroy(); } catch {} });
      return readable.pipe(res);
    } catch (error: any) {
      console.error("Proxy stream error:", error.stack || error);
      if (!res.headersSent) return res.status(502).send(`Upstream stream proxy error: ${error.message || error}`);
    }
  });

  app.get("/api/health", (_req, res) => res.json({
    status: "ok",
    device: "webos-iptv-player",
    playbackTransport: "hls",
    ffmpegAvailable: !!FFMPEG.path,
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
