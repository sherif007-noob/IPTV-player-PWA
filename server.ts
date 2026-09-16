import express from "express";
import path from "path";
import { Readable } from "stream";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { createServer as createViteServer } from "vite";

const PROVIDER_USER_AGENT = process.env.PROVIDER_USER_AGENT || "IPTVSmartersPlayer/3.0.0";
const PROVIDER_REFERER = process.env.PROVIDER_REFERER || "";
const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN || "";
const ALLOWED_IPTV_HOSTS = process.env.ALLOWED_IPTV_HOSTS ? process.env.ALLOWED_IPTV_HOSTS.split(",").map((h) => h.trim().toLowerCase()) : [];

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Stream-Error, ETag");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  function getClientIp(req: express.Request): string {
    const xff = (req.headers["x-forwarded-for"] as string) || "";
    if (xff) return xff.split(",")[0].trim();
    const real = (req.headers["x-real-ip"] as string) || "";
    return real ? real.trim() : req.socket.remoteAddress || "";
  }
  function getUpstreamHeaders(req: express.Request, extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Accept: "*/*", "Accept-Encoding": "identity", ...extra };
    const ua = req.query.ua as string; const referer = req.query.referer as string; const origin = req.query.origin as string;
    if (ua || PROVIDER_USER_AGENT) headers["User-Agent"] = ua || PROVIDER_USER_AGENT;
    if (referer || PROVIDER_REFERER) headers.Referer = referer || PROVIDER_REFERER;
    if (origin || PROVIDER_ORIGIN) headers.Origin = origin || PROVIDER_ORIGIN;
    const clientIp = getClientIp(req);
    if (clientIp) { headers["X-Forwarded-For"] = clientIp; headers["X-Real-IP"] = clientIp; headers["Client-IP"] = clientIp; }
    return headers;
  }
  function validateProxyUrl(urlStr: string): { valid: boolean; error?: string } {
    if (!urlStr || typeof urlStr !== "string") return { valid: false, error: "Missing or invalid URL parameter" };
    let parsed: URL; try { parsed = new URL(urlStr); } catch { return { valid: false, error: "Malformed URL syntax" }; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
    const hostname = parsed.hostname.toLowerCase();
    const privateHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1" || hostname === "169.254.169.254" || hostname.startsWith("10.") || hostname.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal");
    if (privateHost) return { valid: false, error: "Access to private or local network resources is forbidden" };
    if (ALLOWED_IPTV_HOSTS.length && !ALLOWED_IPTV_HOSTS.some((allowed) => hostname === allowed || hostname.endsWith("." + allowed))) return { valid: false, error: `Host '${hostname}' is not in the allowed IPTV providers list` };
    return { valid: true };
  }
  function proxyUrl(url: string, req: express.Request): string {
    const params = new URLSearchParams({ url });
    for (const key of ["ua", "referer", "origin"]) { const value = req.query[key] as string; if (value) params.set(key, value); }
    return `/api/xtream/stream?${params.toString()}`;
  }
  function rewriteM3u8Manifest(text: string, base: string, req: express.Request): string {
    return text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim(); if (!trimmed) return line;
      if (trimmed.startsWith("#EXT")) return line.replace(/URI="([^"]+)"/g, (match, uri) => { try { return `URI="${proxyUrl(new URL(uri, base).toString(), req)}"`; } catch { return match; } });
      if (!trimmed.startsWith("#")) { try { return proxyUrl(new URL(trimmed, base).toString(), req); } catch { return line; } }
      return line;
    }).join("\n");
  }
  function cleanContentType(raw: string | null | undefined, fallback = "application/octet-stream"): string {
    if (!raw) return fallback; const lower = raw.toLowerCase().trim();
    if (lower.includes("json")) return "application/json; charset=utf-8";
    if (lower.includes("html")) return "text/html; charset=utf-8";
    if (lower.includes("mpegurl") || lower.includes("m3u8")) return "application/vnd.apple.mpegurl";
    if (lower.includes("mp2t")) return "video/mp2t"; if (lower.includes("mp4")) return "video/mp4";
    if (lower.includes("matroska") || lower.includes("mkv")) return "video/x-matroska"; if (lower.includes("webm")) return "video/webm";
    if (lower.includes("text/plain")) return "text/plain; charset=utf-8";
    const match = lower.match(/^([a-z0-9!#$%&'*+\-.^_`|~]+\/[a-z0-9!#$%&'*+\-.^_`|~]+)/); return match ? match[1] : fallback;
  }
  function getMp4FallbackUrl(urlStr: string): string | null { try { const parsed = new URL(urlStr); if (!/\.mkv$/i.test(parsed.pathname)) return null; parsed.pathname = parsed.pathname.replace(/\.mkv$/i, ".mp4"); return parsed.toString(); } catch { return null; } }

  function transcodeMkvUrlToMp4(streamUrl: string, req: express.Request, res: express.Response, startSeconds = 0): boolean {
    if (!ffmpegPath) return false;
    const upstreamHeaders = getUpstreamHeaders(req);
    const customHeaders = Object.entries(upstreamHeaders)
      .filter(([key]) => key.toLowerCase() !== "user-agent" && key.toLowerCase() !== "referer")
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    const args = [
      "-hide_banner", "-loglevel", "warning",
      ...(startSeconds > 0 ? ["-ss", String(startSeconds)] : []),
      "-user_agent", upstreamHeaders["User-Agent"] || PROVIDER_USER_AGENT,
      ...(upstreamHeaders.Referer ? ["-referer", upstreamHeaders.Referer] : []),
      ...(customHeaders ? ["-headers", `${customHeaders}\r\n`] : []),
      "-i", streamUrl,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "superfast", "-tune", "zerolatency",
      "-profile:v", "main", "-pix_fmt", "yuv420p", "-bf", "0", "-refs", "1",
      "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-avoid_negative_ts", "make_zero",
      "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
      "-flush_packets", "1", "-f", "mp4", "pipe:1",
    ];
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let shuttingDown = false;
    ffmpeg.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("X-Stream-Transcoded", "mkv-to-mp4-direct-url");
    if (startSeconds > 0) res.setHeader("X-Stream-Start", String(startSeconds));
    const stop = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
    };
    ffmpeg.on("error", (err) => {
      if (!shuttingDown) console.warn("FFmpeg direct URL spawn error:", err.message);
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    ffmpeg.stdout.on("error", (err) => {
      if (!shuttingDown) console.warn("FFmpeg direct URL stdout error:", err.message);
    });
    ffmpeg.on("close", (code) => {
      if (code !== 0 && !shuttingDown && stderr.trim()) console.warn("FFmpeg direct URL exited:", code, stderr.trim().slice(-1000));
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    ffmpeg.stdout.pipe(res);
    res.on("close", stop);
    res.on("error", stop);
    return true;
  }

  app.get("/api/xtream/proxy", async (req, res) => {
    try {
      const targetUrl = req.query.url as string; const validation = validateProxyUrl(targetUrl);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      const response = await fetch(targetUrl, { method: "GET", headers: getUpstreamHeaders(req), redirect: "follow", signal: AbortSignal.timeout(120000) });
      res.writeHead(response.status, { "Content-Type": cleanContentType(response.headers.get("content-type"), "application/json; charset=utf-8") });
      if (!response.body) return res.end(); Readable.fromWeb(response.body as any).pipe(res);
    } catch (err: any) { console.error("Xtream proxy error:", err.message); if (!res.headersSent) res.status(502).json({ error: "Failed to connect to IPTV server", details: err.message }); }
  });

  app.all("/api/xtream/stream", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).send("Method Not Allowed");
    try {
      const streamUrl = req.query.url as string; const validation = validateProxyUrl(streamUrl);
      if (!validation.valid) return res.status(400).send(validation.error);
      const isMkv = (() => { try { return /\.mkv$/i.test(new URL(streamUrl).pathname); } catch { return false; } })();
      const requestedStart = Number(req.query.start); const startSeconds = isMkv && Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0;
      const extraHeaders: Record<string, string> = {};
      if (!isMkv && typeof req.headers.range === "string") extraHeaders.Range = req.headers.range;
      if (typeof req.headers["if-range"] === "string") extraHeaders["If-Range"] = req.headers["if-range"];
      if (typeof req.headers["if-none-match"] === "string") extraHeaders["If-None-Match"] = req.headers["if-none-match"];
      if (typeof req.headers["if-modified-since"] === "string") extraHeaders["If-Modified-Since"] = req.headers["if-modified-since"];
      const mp4FallbackUrl = getMp4FallbackUrl(streamUrl);
      if (mp4FallbackUrl) {
        const mp4Response = await fetch(mp4FallbackUrl, { method: req.method, headers: getUpstreamHeaders(req, extraHeaders), redirect: "follow", signal: AbortSignal.timeout(120000) });
        if (mp4Response.ok) {
          const upstreamUrl = mp4Response.url || mp4FallbackUrl;
          const safeContentType = cleanContentType(mp4Response.headers.get("content-type"), "video/mp4");
          const forwardHeaders: Record<string, string> = { "Content-Type": safeContentType, "Accept-Ranges": mp4Response.headers.get("accept-ranges") || "bytes" };
          for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) { const value = mp4Response.headers.get(key); if (value) forwardHeaders[key] = value; }
          res.writeHead(mp4Response.status, forwardHeaders);
          if (req.method === "HEAD") return res.end();
          if (!mp4Response.body) return res.end();
          const readable = Readable.fromWeb(mp4Response.body as any);
          req.on("close", () => { if (!res.writableEnded) { try { readable.destroy(); } catch {} } });
          readable.on("error", (err: any) => { console.warn("MP4 stream pipe notice:", err.message); if (!res.writableEnded) res.end(); });
          return readable.pipe(res);
        }
        console.log(`MP4 variant unavailable (${mp4Response.status}); using direct MKV FFmpeg input: ${streamUrl}`);
      }
      if (isMkv) {
        if (req.method === "HEAD") {
          const probe = await fetch(streamUrl, { method: "HEAD", headers: getUpstreamHeaders(req), redirect: "follow", signal: AbortSignal.timeout(120000) });
          if (!probe.ok) return res.status(probe.status).send(`Upstream stream error: ${probe.status} - ${probe.statusText}`);
          const forwardHeaders: Record<string, string> = { "Content-Type": cleanContentType(probe.headers.get("content-type"), "video/x-matroska"), "Accept-Ranges": probe.headers.get("accept-ranges") || "bytes" };
          for (const key of ["content-length", "etag", "last-modified", "cache-control"]) { const value = probe.headers.get(key); if (value) forwardHeaders[key] = value; }
          return res.writeHead(probe.status, forwardHeaders).end();
        }
        if (transcodeMkvUrlToMp4(streamUrl, req, res, startSeconds)) return;
      }
      const upstream = await fetch(streamUrl, { method: req.method, headers: getUpstreamHeaders(req, extraHeaders), redirect: "follow", signal: AbortSignal.timeout(120000) });
      if (!upstream.ok && upstream.status >= 400) { const errText = await upstream.text().catch(() => ""); const safeError = (errText || upstream.statusText).replace(/[^\x20-\x7E]/g, " ").slice(0, 200); res.setHeader("X-Stream-Error", safeError); return res.status(upstream.status).send(`Upstream stream error: ${upstream.status} - ${safeError}`); }
      const upstreamUrl = upstream.url || streamUrl; const lowerUrl = upstreamUrl.toLowerCase(); const isM3u8 = lowerUrl.includes(".m3u8") || lowerUrl.includes("type=m3u_plus");
      let defaultType = "video/mp4"; if (isM3u8) defaultType = "application/vnd.apple.mpegurl"; else if (lowerUrl.includes(".ts")) defaultType = "video/mp2t"; else if (lowerUrl.includes(".mkv")) defaultType = "video/x-matroska"; else if (lowerUrl.includes(".webm")) defaultType = "video/webm"; else if (lowerUrl.includes(".mov")) defaultType = "video/quicktime";
      const safeContentType = cleanContentType(upstream.headers.get("content-type"), defaultType); const isPlaylist = isM3u8 || safeContentType.includes("mpegurl") || safeContentType.includes("application/x-mpegurl");
      if (isPlaylist && req.method === "GET") { const manifestText = await upstream.text(); const rewritten = rewriteM3u8Manifest(manifestText, upstream.url || upstreamUrl, req); res.writeHead(upstream.status, { "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": Buffer.byteLength(rewritten, "utf8"), "Cache-Control": "no-cache, no-store, must-revalidate" }); return res.end(rewritten); }
      const forwardHeaders: Record<string, string> = { "Content-Type": safeContentType, "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes" };
      for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) { const value = upstream.headers.get(key); if (value) forwardHeaders[key] = value; }
      res.writeHead(upstream.status, forwardHeaders); if (req.method === "HEAD") return res.end(); if (!upstream.body) return res.end();
      const readable = Readable.fromWeb(upstream.body as any); req.on("close", () => { if (!res.writableEnded) { try { readable.destroy(); } catch {} } }); readable.on("error", (err: any) => { console.warn("Stream pipe notice:", err.message); if (!res.writableEnded) res.end(); }); readable.pipe(res);
    } catch (err: any) { console.error("Proxy stream error:", err.stack || err); if (!res.headersSent) res.status(502).send("Upstream stream proxy error: " + (err.message || err)); }
  });
  app.get("/api/health", (_req, res) => { res.json({ status: "ok", device: "webos-iptv-player", ffmpegAvailable: !!ffmpegPath, upstreamUserAgent: PROVIDER_USER_AGENT, customRefererSet: !!PROVIDER_REFERER, customOriginSet: !!PROVIDER_ORIGIN }); });
  if (process.env.NODE_ENV !== "production") { const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" }); app.use(vite.middlewares); }
  else { const distPath = path.join(process.cwd(), "dist"); app.use(express.static(distPath)); app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html"))); }
  app.listen(PORT, "0.0.0.0", () => console.log(`WebOS Xtream IPTV server running on http://0.0.0.0:${PORT}`));
}
startServer();
