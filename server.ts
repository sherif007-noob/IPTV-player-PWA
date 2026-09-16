import express from "express";
import path from "path";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";

// ============================================================================
// CONFIGURABLE UPSTREAM HEADERS & TARGET SETTINGS
// Easily configure custom headers needed by IPTV providers in one central place.
// ============================================================================
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

  // Global CORS Middleware for all API routes (PWA <-> Express API)
  app.use("/api", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Stream-Error"
    );

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // Helper to extract client IP for geo-locked IPTV servers
  function getClientIp(req: express.Request): string {
    const rawXff = (req.headers["x-forwarded-for"] as string) || "";
    if (rawXff) {
      const first = rawXff.split(",")[0].trim();
      if (first) return first;
    }
    const realIp = (req.headers["x-real-ip"] as string) || "";
    if (realIp) return realIp.trim();
    return req.socket.remoteAddress || "";
  }

  // Build standard upstream headers (only sending headers that are actually configured)
  function getUpstreamHeaders(req: express.Request, extraHeaders?: Record<string, string>): Record<string, string> {
    const q_ua = req.query.ua as string;
    const q_referer = req.query.referer as string;
    const q_origin = req.query.origin as string;
    const clientIp = getClientIp(req);
    const safeExtraHeaders = extraHeaders || {};
    // Anti-geo-block: if our datacenter IP is blocked, some IPTV panels trust X-Forwarded-For to authorize the client's home IP
    if (clientIp) {
      safeExtraHeaders["X-Forwarded-For"] = clientIp;
    }
    const headers: Record<string, string> = {
      Accept: "*/*",
      ...safeExtraHeaders,
    };

    // User-Agent
    if (q_ua) {
      headers["User-Agent"] = q_ua;
    } else if (PROVIDER_USER_AGENT) {
      headers["User-Agent"] = PROVIDER_USER_AGENT;
    }

    // Referer
    if (q_referer) {
      headers["Referer"] = q_referer;
    } else if (PROVIDER_REFERER) {
      headers["Referer"] = PROVIDER_REFERER;
    }

    // Origin
    if (q_origin) {
      headers["Origin"] = q_origin;
    } else if (PROVIDER_ORIGIN) {
      headers["Origin"] = PROVIDER_ORIGIN;
    }

    // Forward client IP for providers that bind session tokens to IP
    if (clientIp) {
      headers["X-Forwarded-For"] = clientIp;
      headers["X-Real-IP"] = clientIp;
      headers["Client-IP"] = clientIp;
    }

    return headers;
  }

  // Validate that requested target URLs are valid HTTP(S) and not arbitrary internal network addresses (SSRF prevention)
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

    // Block private/internal addresses to avoid turning into an open arbitrary proxy
    const isPrivateOrLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "169.254.169.254" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal");

    if (isPrivateOrLoopback) {
      return { valid: false, error: "Access to private or local network resources is forbidden" };
    }

    // If explicit allowed hosts list is defined, verify membership
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

  // Rewrite HLS M3U8 manifest content so all sub-manifests and TS segments route through the streaming proxy
  function rewriteM3u8Manifest(manifestText: string, manifestBaseUrl: string): string {
    const lines = manifestText.split(/\r?\n/);
    const rewrittenLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite URI attributes in tags (e.g. #EXT-X-KEY:METHOD=AES-128,URI="...")
      if (trimmed.startsWith("#EXT")) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          try {
            const absolute = new URL(uri, manifestBaseUrl).toString();
            return `URI="/api/xtream/stream?url=${encodeURIComponent(absolute)}"`;
          } catch {
            return match;
          }
        });
      }

      // Rewrite segment or sub-playlist URLs (non-# comments)
      if (!trimmed.startsWith("#")) {
        try {
          const absolute = new URL(trimmed, manifestBaseUrl).toString();
          return `/api/xtream/stream?url=${encodeURIComponent(absolute)}`;
        } catch {
          return line;
        }
      }

      return line;
    });

    return rewrittenLines.join("\n");
  }

  // Sanitize Content-Type to prevent malformed upstream headers from throwing TypeError in Express
  function cleanContentType(
    raw: string | null | undefined,
    fallback: string = "application/json; charset=utf-8"
  ): string {
    if (!raw) return fallback;
    const lower = raw.toLowerCase().trim();
    if (lower.includes("json")) {
      return "application/json; charset=utf-8";
    }
    if (lower.includes("html")) {
      return "text/html; charset=utf-8";
    }
    if (lower.includes("xml")) {
      return "application/xml; charset=utf-8";
    }
    if (lower.includes("mpegurl") || lower.includes("m3u8")) {
      return "application/vnd.apple.mpegurl";
    }
    if (lower.includes("mp2t")) {
      return "video/mp2t";
    }
    if (lower.includes("mp4")) {
      return "video/mp4";
    }
    if (lower.includes("matroska") || lower.includes("mkv")) {
      return "video/x-matroska";
    }
    if (lower.includes("webm")) {
      return "video/webm";
    }
    if (lower.includes("text/plain")) {
      return "text/plain; charset=utf-8";
    }
    const mimeMatch = lower.match(
      /^([a-z0-9!#$%&'*+\-.^_`|~]+\/[a-z0-9!#$%&'*+\-.^_`|~]+)/
    );
    if (mimeMatch) {
      return mimeMatch[1];
    }
    return fallback;
  }

  // ============================================================================
  // 1. XTREAM CODES API PROXY
  // Proxies player_api.php requests, categories, stream lists, EPG, and metadata.
  // ============================================================================
  app.get("/api/xtream/proxy", async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      const validation = validateProxyUrl(targetUrl);
      if (!validation.valid) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: validation.error }));
      }

      const reqHeaders = getUpstreamHeaders(req);

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: reqHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(120000),
      });

      const rawContentType = response.headers.get("content-type");
      const safeContentType = cleanContentType(rawContentType, "application/json; charset=utf-8");

      res.writeHead(response.status, {
        "Content-Type": safeContentType,
      });

      if (response.body) {
        // @ts-ignore
        const readable = Readable.fromWeb(response.body);
        readable.on("error", (streamErr: any) => {
          console.error("Proxy streaming error:", streamErr.message);
          if (!res.headersSent) {
            res.status(502).end();
          }
        });
        readable.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error("Xtream proxy error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, {
          "Content-Type": "application/json; charset=utf-8",
        });
        return res.end(
          JSON.stringify({
            error: "Failed to connect to IPTV server",
            details: err.message,
          })
        );
      }
    }
  });

  // ============================================================================
  // 2. IPTV STREAM PROXY
  // Supports HLS manifests (.m3u8), HLS segments (.ts), MP4/MKV VOD, Range requests,
  // chunked streaming, redirects, and correct Content-Type.
  // ============================================================================
  app.all("/api/xtream/stream", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const streamUrl = req.query.url as string;
      const validation = validateProxyUrl(streamUrl);
      if (!validation.valid) {
        return res.status(400).send(validation.error);
      }

      const extraHeaders: Record<string, string> = {};
      if (req.headers.range) {
        extraHeaders["Range"] = req.headers.range;
      }

      const headers = getUpstreamHeaders(req, extraHeaders);

      const upstream = await fetch(streamUrl, {
        method: req.method,
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
      });

      if (!upstream.ok && upstream.status >= 400) {
        const errText = await upstream.text().catch(() => "");
        if (upstream.status !== 404) console.warn(`Upstream stream error (${upstream.status}):`, errText.slice(0, 200));
        
        // Sanitize header value to prevent ERR_INVALID_CHAR (remove newlines and control characters)
        const safeErrorHeader = (errText || upstream.statusText)
          .replace(/[^\x20-\x7E]/g, ' ')
          .slice(0, 200);
          
        res.setHeader("X-Stream-Error", safeErrorHeader);
        return res
          .status(upstream.status)
          .send(`Upstream stream error: ${upstream.status} - ${safeErrorHeader}`);
      }

      // Determine default content type based on URL extension
      let defaultType = "video/mp4";
      const cleanLowerUrl = streamUrl.toLowerCase();
      const isM3u8 = cleanLowerUrl.includes(".m3u8") || cleanLowerUrl.includes("type=m3u_plus");
      if (isM3u8) {
        defaultType = "application/vnd.apple.mpegurl";
      } else if (cleanLowerUrl.includes(".ts")) {
        defaultType = "video/mp2t";
      } else if (cleanLowerUrl.includes(".mkv")) {
        defaultType = "video/x-matroska";
      } else if (cleanLowerUrl.includes(".webm")) {
        defaultType = "video/webm";
      }

      const rawContentType = upstream.headers.get("content-type");
      const safeContentType = cleanContentType(rawContentType, defaultType);

      // Check if this is an HLS playlist manifest to rewrite internal relative/absolute URLs
      const isPlaylist =
        isM3u8 ||
        safeContentType.includes("mpegurl") ||
        safeContentType.includes("application/x-mpegurl");

      if (isPlaylist && req.method === "GET") {
        const manifestText = await upstream.text();
        const finalUrl = upstream.url || streamUrl;
        const rewritten = rewriteM3u8Manifest(manifestText, finalUrl);

        res.writeHead(upstream.status, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Content-Length": Buffer.byteLength(rewritten, "utf8"),
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        return res.end(rewritten);
      }

      const forwardHeaders: Record<string, string> = {
        "Content-Type": safeContentType,
        "Accept-Ranges": "bytes",
      };

      upstream.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (
          ["content-length", "content-range", "accept-ranges"].includes(lowerKey)
        ) {
          forwardHeaders[key] = value;
        }
      });

      res.writeHead(upstream.status, forwardHeaders);

      if (req.method === "HEAD") {
        return res.end();
      }

      if (upstream.body) {
        // @ts-ignore
        const readable = Readable.fromWeb(upstream.body);
        req.on("close", () => {
          try {
            readable.destroy();
          } catch {}
        });
        readable.on("error", (pipeErr: any) => {
          console.warn("Stream pipe notice:", pipeErr.message);
          try {
            res.end();
          } catch {}
        });
        readable.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error("Proxy stream error:", err.stack || err);
      if (!res.headersSent) {
        res.status(502).send("Upstream stream proxy error: " + (err.stack || err.message || err));
      }
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      device: "webos-iptv-player",
      upstreamUserAgent: PROVIDER_USER_AGENT,
      customRefererSet: !!PROVIDER_REFERER,
      customOriginSet: !!PROVIDER_ORIGIN,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`WebOS Xtream IPTV server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
