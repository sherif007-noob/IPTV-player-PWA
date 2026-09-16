import express from "express";
import path from "path";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
    // Extract standard MIME type (e.g. video/mp2t, application/vnd.apple.mpegurl)
    const mimeMatch = lower.match(
      /^([a-z0-9!#$%&'*+\-.^_`|~]+\/[a-z0-9!#$%&'*+\-.^_`|~]+)/
    );
    if (mimeMatch) {
      return mimeMatch[1];
    }
    return fallback;
  }

  // CORS preflight for proxy and stream
  app.options(["/api/xtream/proxy", "/api/xtream/stream"], (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.sendStatus(204);
  });

  // Xtream Codes API Proxy to bypass CORS and Mixed Content on TV/Browser
  app.get("/api/xtream/proxy", async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(JSON.stringify({ error: "Missing 'url' query parameter" }));
      }

      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(JSON.stringify({ error: "Invalid URL parameter" }));
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(JSON.stringify({ error: "Invalid protocol" }));
      }

      const clientIp = getClientIp(req);
      const reqHeaders: Record<string, string> = {
        "User-Agent": "IPTVSmartersPlayer/3.0.0",
        "Accept": "*/*",
      };
      if (clientIp) {
        reqHeaders["X-Forwarded-For"] = clientIp;
        reqHeaders["X-Real-IP"] = clientIp;
        reqHeaders["Client-IP"] = clientIp;
      }

      const response = await fetch(targetUrl, {
        headers: reqHeaders,
        signal: AbortSignal.timeout(120000),
      });

      const rawContentType = response.headers.get("content-type");
      const safeContentType = cleanContentType(rawContentType);

      res.writeHead(response.status, {
        "Content-Type": safeContentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
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
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(
          JSON.stringify({
            error: "Failed to connect to Xtream server",
            details: err.message,
          })
        );
      }
    }
  });

  // Xtream Stream Proxy (optional fallback if direct stream fails with CORS or Mixed Content)
  app.all("/api/xtream/stream", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const streamUrl = req.query.url as string;
      if (!streamUrl) {
        return res.status(400).send("Missing stream url");
      }

      const clientIp = getClientIp(req);
      const range = req.headers.range;
      const headers: Record<string, string> = {
        "User-Agent": "IPTVSmartersPlayer/3.0.0",
        "Accept": "*/*",
      };
      if (clientIp) {
        headers["X-Forwarded-For"] = clientIp;
        headers["X-Real-IP"] = clientIp;
        headers["Client-IP"] = clientIp;
      }
      if (range) {
        headers["Range"] = range;
      }

      const upstream = await fetch(streamUrl, {
        method: req.method,
        headers,
      });

      if (!upstream.ok && upstream.status >= 400) {
        const errText = await upstream.text().catch(() => "");
        console.warn(`Upstream stream error (${upstream.status}):`, errText);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Stream-Error", (errText || upstream.statusText).slice(0, 200));
        res.setHeader("Access-Control-Expose-Headers", "X-Stream-Error");
        return res
          .status(upstream.status)
          .send(`Upstream stream error: ${upstream.status} - ${errText || upstream.statusText}`);
      }

      // Determine default content type based on URL extension
      let defaultType = "video/mp4";
      const cleanLowerUrl = streamUrl.toLowerCase();
      if (cleanLowerUrl.includes(".m3u8")) {
        defaultType = "application/vnd.apple.mpegurl";
      } else if (cleanLowerUrl.includes(".ts")) {
        defaultType = "video/mp2t";
      } else if (cleanLowerUrl.includes(".mkv")) {
        defaultType = "video/x-matroska";
      } else if (cleanLowerUrl.includes(".webm")) {
        defaultType = "video/webm";
      }

      const forwardHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
        "Accept-Ranges": "bytes",
      };

      upstream.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (
          ["content-type", "content-length", "content-range", "accept-ranges"].includes(
            lowerKey
          )
        ) {
          if (lowerKey === "content-type") {
            forwardHeaders["Content-Type"] = cleanContentType(value, defaultType);
          } else {
            forwardHeaders[key] = value;
          }
        }
      });

      if (!forwardHeaders["Content-Type"]) {
        forwardHeaders["Content-Type"] = defaultType;
      }

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
      console.error("Proxy stream error:", err);
      if (!res.headersSent) {
        res.status(502).send("Upstream stream proxy error");
      }
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", device: "webos-iptv-player" });
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
