import express from "express";
import path from "path";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";

const PROVIDER_USER_AGENT = process.env.PROVIDER_USER_AGENT || "IPTVSmartersPlayer/3.0.0";
const PROVIDER_REFERER = process.env.PROVIDER_REFERER || "";
const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN || "";
const ALLOWED_IPTV_HOSTS = process.env.ALLOWED_IPTV_HOSTS
  ? process.env.ALLOWED_IPTV_HOSTS.split(",").map((h) => h.trim().toLowerCase())
  : [];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Stream-Error, ETag"
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  function getClientIp(req: express.Request): string {
    const rawXff = (req.headers["x-forwarded-for"] as string) || "";
    if (rawXff) return rawXff.split(",")[0].trim();
    const realIp = (req.headers["x-real-ip"] as string) || "";
    if (realIp) return realIp.trim();
    return req.socket.remoteAddress || "";
  }

  function getUpstreamHeaders(
    req: express.Request,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> {
    const q_ua = req.query.ua as string;
    const q_referer = req.query.referer as string;
    const q_origin = req.query.origin as string;
    const headers: Record<string, string> = {
      Accept: "*/*",
      "Accept-Encoding": "identity",
      ...extraHeaders,
    };

    if (q_ua || PROVIDER_USER_AGENT) headers["User-Agent"] = q_ua || PROVIDER_USER_AGENT;
    if (q_referer || PROVIDER_REFERER) headers.Referer = q_referer || PROVIDER_REFERER;
    if (q_origin || PROVIDER_ORIGIN) headers.Origin = q_origin || PROVIDER_ORIGIN;

    // Preserve the existing IPTV-provider compatibility behavior.
    const clientIp = getClientIp(req);
    if (clientIp) {
      headers["X-Forwarded-For"] = clientIp;
      headers["X-Real-IP"] = clientIp;
      headers["Client-IP"] = clientIp;
    }

    return headers;
  }

  function validateProxyUrl(urlStr: string): { valid: boolean; error?: string; parsed?: URL } {
    if (!urlStr || typeof urlStr !== "string") {
      return { valid: false, error: "Missing or invalid URL parameter" };
    }
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { valid: false, error: "Malformed URL syntax" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
    }
    const hostname = parsed.hostname.toLowerCase();
    const isPrivateOrLoopback =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" ||
      hostname === "::1" || hostname === "169.254.169.254" || hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.endsWith(".local") || hostname.endsWith(".internal");
    if (isPrivateOrLoopback) {
      return { valid: false, error: "Access to private or local network resources is forbidden" };
    }
    if (ALLOWED_IPTV_HOSTS.length > 0) {
      const isAllowed = ALLOWED_IPTV_HOSTS.some(
        (allowed) => hostname === allowed || hostname.endsWith("." + allowed)
      );
      if (!isAllowed) {
        return { valid: false, error: `Host '${hostname}' is not in the allowed IPTV providers list` };
      }
    }
    return { valid: true, parsed };
  }

  function proxyUrl(url: string, req: express.Request): string {
    const params = new URLSearchParams({ url });
    const ua = req.query.ua as string;
    const referer = req.query.referer as string;
    const origin = req.query.origin as string;
    if (ua) params.set("ua", ua);
    if (referer) params.set("referer", referer);
    if (origin) params.set("origin", origin);
    return `/api/xtream/stream?${params.toString()}`;
  }

  function rewriteM3u8Manifest(manifestText: string, manifestBaseUrl: string, req: express.Request): string {
    return manifestText.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#EXT")) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          try {
            const absolute = new URL(uri, manifestBaseUrl).toString();
            return `URI="${proxyUrl(absolute, req)}"`;
          } catch {
            return match;
          }
        });
      }

      if (!trimmed.startsWith("#")) {
        try {
          const absolute = new URL(trimmed, manifestBaseUrl).toString();
          return proxyUrl(absolute, req);
        } catch {
          return line;
        }
      }
      return line;
    }).join("\n");
  }

  function cleanContentType(raw: string | null | undefined, fallback = "application/octet-stream"): string {
    if (!raw) return fallback;
    const lower = raw.toLowerCase().trim();
    if (lower.includes("json")) return "application/json; charset=utf-8";
    if (lower.includes("html")) return "text/html; charset=utf-8";
    if (lower.includes("mpegurl") || lower.includes("m3u8")) return "application/vnd.apple.mpegurl";
    if (lower.includes("mp2t")) return "video/mp2t";
    if (lower.includes("mp4")) return "video/mp4";
    if (lower.includes("matroska") || lower.includes("mkv")) return "video/x-matroska";
    if (lower.includes("webm")) return "video/webm";
    if (lower.includes("text/plain")) return "text/plain; charset=utf-8";
    const mimeMatch = lower.match(/^([a-z0-9!#$%&'*+\-.^_`|~]+\/[a-z0-9!#$%&'*+\-.^_`|~]+)/);
    return mimeMatch ? mimeMatch[1] : fallback;
  }

  app.get("/api/xtream/proxy", async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      const validation = validateProxyUrl(targetUrl);
      if (!validation.valid) return res.status(400).json({ error: validation.error });

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: getUpstreamHeaders(req),
        redirect: "follow",
        signal: AbortSignal.timeout(120000),
      });
      const safeContentType = cleanContentType(response.headers.get("content-type"), "application/json; charset=utf-8");
      res.writeHead(response.status, { "Content-Type": safeContentType });
      if (!response.body) return res.end();
      // @ts-ignore Node's Readable.fromWeb is available in the runtime used by this app.
      Readable.fromWeb(response.body).pipe(res);
    } catch (err: any) {
      console.error("Xtream proxy error:", err.message);
      if (!res.headersSent) res.status(502).json({ error: "Failed to connect to IPTV server", details: err.message });
    }
  });

  // Browser VOD/Series stream proxy. Handles Range requests and HLS recursively.
  app.all("/api/xtream/stream", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).send("Method Not Allowed");

    try {
      const streamUrl = req.query.url as string;
      const validation = validateProxyUrl(streamUrl);
      if (!validation.valid) return res.status(400).send(validation.error);

      const extraHeaders: Record<string, string> = {};
      for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
        const value = req.headers[name];
        if (typeof value === "string" && value) {
          extraHeaders[name.replace(/(^|-)([a-z])/g, (_, p, c) => c.toUpperCase())] = value;
        }
      }

      const upstream = await fetch(streamUrl, {
        method: req.method,
        headers: getUpstreamHeaders(req, extraHeaders),
        redirect: "follow",
        signal: AbortSignal.timeout(120000),
      });

      if (!upstream.ok && upstream.status >= 400) {
        const errText = await upstream.text().catch(() => "");
        const safeError = (errText || upstream.statusText).replace(/[^\x20-\x7E]/g, " ").slice(0, 200);
        res.setHeader("X-Stream-Error", safeError);
        return res.status(upstream.status).send(`Upstream stream error: ${upstream.status} - ${safeError}`);
      }

      const cleanLowerUrl = streamUrl.toLowerCase();
      const isM3u8 = cleanLowerUrl.includes(".m3u8") || cleanLowerUrl.includes("type=m3u_plus");
      let defaultType = "video/mp4";
      if (isM3u8) defaultType = "application/vnd.apple.mpegurl";
      else if (cleanLowerUrl.includes(".ts")) defaultType = "video/mp2t";
      else if (cleanLowerUrl.includes(".mkv")) defaultType = "video/x-matroska";
      else if (cleanLowerUrl.includes(".webm")) defaultType = "video/webm";
      else if (cleanLowerUrl.includes(".mov")) defaultType = "video/quicktime";

      const safeContentType = cleanContentType(upstream.headers.get("content-type"), defaultType);
      const isPlaylist = isM3u8 || safeContentType.includes("mpegurl") || safeContentType.includes("application/x-mpegurl");

      if (isPlaylist && req.method === "GET") {
        const manifestText = await upstream.text();
        const finalUrl = upstream.url || streamUrl;
        const rewritten = rewriteM3u8Manifest(manifestText, finalUrl, req);
        return res.writeHead(upstream.status, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Content-Length": Buffer.byteLength(rewritten, "utf8"),
          "Cache-Control": "no-cache, no-store, must-revalidate",
        }).end(rewritten);
      }

      const forwardHeaders: Record<string, string> = {
        "Content-Type": safeContentType,
        "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      };
      for (const key of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
        const value = upstream.headers.get(key);
        if (value) forwardHeaders[key] = value;
      }

      res.writeHead(upstream.status, forwardHeaders);
      if (req.method === "HEAD") return res.end();
      if (!upstream.body) return res.end();

      // @ts-ignore Node's Readable.fromWeb is available in the runtime used by this app.
      const readable = Readable.fromWeb(upstream.body);
      req.on("close", () => {
        if (!res.writableEnded) {
          try { readable.destroy(); } catch {}
        }
      });
      readable.on("error", (err: any) => {
        console.warn("Stream pipe notice:", err.message);
        if (!res.writableEnded) res.end();
      });
      readable.pipe(res);
    } catch (err: any) {
      console.error("Proxy stream error:", err.stack || err);
      if (!res.headersSent) res.status(502).send("Upstream stream proxy error: " + (err.message || err));
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      device: "webos-iptv-player",
      upstreamUserAgent: PROVIDER_USER_AGENT,
      customRefererSet: !!PROVIDER_REFERER,
      customOriginSet: !!PROVIDER_ORIGIN,
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`WebOS Xtream IPTV server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();