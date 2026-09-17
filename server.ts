import express from "express";
import path from "path";
import { Readable } from "stream";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { createServer as createViteServer } from "vite";

const PROVIDER_USER_AGENT = process.env.PROVIDER_USER_AGENT || "IPTVSmartersPlayer/3.0.0";
const PROVIDER_REFERER = process.env.PROVIDER_REFERER || "";
const PROVIDER_ORIGIN = process.env.PROVIDER_ORIGIN || "";
const ALLOWED_IPTV_HOSTS = process.env.ALLOWED_IPTV_HOSTS ? process.env.ALLOWED_IPTV_HOSTS.split(",").map(h => h.trim().toLowerCase()) : [];
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
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Stream-Error, X-Stream-Start, X-Stream-Transcoded, X-Stream-Range-Probe, X-Playback-Session, X-Playback-Id, ETag");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const cleanId = (v: unknown) => typeof v === "string" ? v.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120) : "";
  const identity = (req: express.Request) => ({ session: cleanId(req.query.session), playback: cleanId(req.query.playback) });
  const stopActive = (session: string, playback: string | undefined, reason: string) => {
    if (!session) return false;
    const cur = active.get(session);
    if (!cur) return false;
    if (playback && cur.playback !== playback) {
      console.log(`Ignoring stale stop session=${session} playback=${playback}; active=${cur.playback}`);
      return false;
    }
    active.delete(session);
    console.log(`Stopping transcode session=${session} playback=${cur.playback}: ${reason}`);
    try { cur.stop(reason); } catch {}
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
    const h: Record<string, string> = { Accept: "*/*", "Accept-Encoding": "identity", ...extra };
    const ua = String(req.query.ua || PROVIDER_USER_AGENT || "");
    const referer = String(req.query.referer || PROVIDER_REFERER || "");
    const origin = String(req.query.origin || PROVIDER_ORIGIN || "");
    if (ua) h["User-Agent"] = ua;
    if (referer) h.Referer = referer;
    if (origin) h.Origin = origin;
    const ip = getClientIp(req);
    if (ip) { h["X-Forwarded-For"] = ip; h["X-Real-IP"] = ip; h["Client-IP"] = ip; }
    return h;
  }
  function validate(urlStr: string) {
    if (!urlStr) return "Missing URL";
    let u: URL; try { u = new URL(urlStr); } catch { return "Malformed URL"; }
    if (!/^https?:$/.test(u.protocol)) return "Only HTTP/HTTPS URLs are allowed";
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.startsWith("10.") || h.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".local") || h.endsWith(".internal")) return "Private hosts are forbidden";
    if (ALLOWED_IPTV_HOSTS.length && !ALLOWED_IPTV_HOSTS.some(a => h === a || h.endsWith("." + a))) return `Host '${h}' is not allowed`;
    return "";
  }
  function contentType(raw: string | null, fallback: string) {
    const s = (raw || "").toLowerCase();
    if (s.includes("mpegurl") || s.includes("m3u8")) return "application/vnd.apple.mpegurl";
    if (s.includes("mp2t")) return "video/mp2t";
    if (s.includes("mp4")) return "video/mp4";
    if (s.includes("matroska") || s.includes("mkv")) return "video/x-matroska";
    if (s.includes("webm")) return "video/webm";
    if (s.includes("json")) return "application/json; charset=utf-8";
    if (s.includes("html")) return "text/html; charset=utf-8";
    return fallback;
  }
  function mp4Fallback(urlStr: string) {
    try { const u = new URL(urlStr); if (!/\.mkv$/i.test(u.pathname)) return null; u.pathname = u.pathname.replace(/\.mkv$/i, ".mp4"); return u.toString(); } catch { return null; }
  }
  function proxyUrl(url: string, req: express.Request) {
    const p = new URLSearchParams({ url });
    for (const k of ["ua", "referer", "origin"]) { const v = req.query[k]; if (typeof v === "string" && v) p.set(k, v); }
    return `/api/xtream/stream?${p}`;
  }
  function rewriteM3u8(text: string, base: string, req: express.Request) {
    return text.split(/\r?\n/).map(line => {
      const t = line.trim(); if (!t) return line;
      if (t.startsWith("#EXT")) return line.replace(/URI="([^"]+)"/g, (m, uri) => { try { return `URI="${proxyUrl(new URL(uri, base).toString(), req)}"`; } catch { return m; } });
      if (!t.startsWith("#")) { try { return proxyUrl(new URL(t, base).toString(), req); } catch {} }
      return line;
    }).join("\n");
  }
  const outputArgs = () => ["-map","0:v:0","-map","0:a:0?","-c:v","libx264","-preset","superfast","-tune","zerolatency","-profile:v","main","-pix_fmt","yuv420p","-bf","0","-refs","1","-g","48","-keyint_min","48","-sc_threshold","0","-c:a","aac","-b:a","128k","-ar","48000","-avoid_negative_ts","make_zero","-movflags","+frag_keyframe+empty_moov+default_base_moof","-flush_packets","1","-f","mp4","pipe:1"];
  function transcodeHeaders(res: express.Response, start: number, mode: string, session: string, playback: string) {
    res.statusCode = 200; res.setHeader("Content-Type","video/mp4"); res.setHeader("Cache-Control","no-store, no-cache, must-revalidate"); res.setHeader("Accept-Ranges","none"); res.setHeader("X-Stream-Start",String(start)); res.setHeader("X-Stream-Transcoded",mode);
    if (session) res.setHeader("X-Playback-Session", session); if (playback) res.setHeader("X-Playback-Id", playback);
  }

  function directFfmpeg(args: string[], res: express.Response, start: number, rangeMode: string, session: string, playback: string) {
    if (!ffmpegPath) return false;
    const ff = spawn(ffmpegPath, args, { stdio: ["ignore","pipe","pipe"] });
    let stderr = "", output = false, stopped = false, timer: NodeJS.Timeout | null = null;
    const stop: StopFn = reason => {
      if (stopped) return; stopped = true; if (timer) clearTimeout(timer);
      console.log(`Direct FFmpeg stop session=${session || "none"} playback=${playback || "none"}: ${reason}`);
      try { if (!ff.killed) ff.kill("SIGKILL"); } catch {} try { ff.stdout.destroy(); } catch {} if (!res.writableEnded && !res.destroyed) try { res.end(); } catch {}
    };
    register(session, playback, stop); transcodeHeaders(res, start, "mkv-to-mp4-direct-url-seek", session, playback); res.setHeader("X-Stream-Range-Probe", rangeMode);
    ff.stderr.on("data", c => { const s=c.toString(); stderr += s; console.log(`FFmpeg MKV seek: ${s.trimEnd()}`); });
    ff.stdout.on("data", () => { if (!output) { output=true; if (timer) clearTimeout(timer); console.log(`FFmpeg MKV seek produced first MP4 output bytes session=${session || "none"} playback=${playback || "none"}`); } });
    ff.on("error", e => { if (!stopped) console.warn("FFmpeg MKV seek spawn error:", e.message); if (!res.writableEnded && !res.destroyed) res.end(); });
    ff.on("close", code => { if (timer) clearTimeout(timer); clearActive(session, playback); console.log(`FFmpeg MKV seek exited code=${code} output=${output} stopped=${stopped}; ${stderr.trim().slice(-2500) || "no diagnostics"}`); if (!res.writableEnded && !res.destroyed) res.end(); });
    timer = setTimeout(() => { if (!output && !stopped) stop(`no output in 30s: ${stderr.trim().slice(-1500) || "no diagnostics"}`); }, 30000);
    ff.stdout.pipe(res); res.on("close", () => { clearActive(session, playback); stop("client response closed"); }); res.on("error", () => { clearActive(session, playback); stop("client response error"); });
    return true;
  }

  async function transcodeMkv(url: string, req: express.Request, res: express.Response, start: number, session: string, playback: string) {
    if (!ffmpegPath) return false;
    const h = upstreamHeaders(req);
    const ffHeaders = Object.entries(h).filter(([k]) => !["user-agent","referer","host"].includes(k.toLowerCase())).map(([k,v]) => `${k}: ${v}`).join("\r\n");
    if (start > 0) {
      let finalUrl = url, ranges = false;
      try {
        const probe = await fetch(url, { method:"GET", headers:upstreamHeaders(req,{Range:"bytes=0-1"}), redirect:"follow", signal:AbortSignal.timeout(15000) });
        const ar=probe.headers.get("accept-ranges")||"", cr=probe.headers.get("content-range")||""; ranges=probe.status===206 || /bytes/i.test(ar) || /^bytes\s/i.test(cr); finalUrl=probe.url||url;
        console.log(`MKV seek probe: status=${probe.status} rangeSupported=${ranges} acceptRanges=${ar||"none"} contentRange=${cr||"none"} finalUrl=${finalUrl}`); try { await probe.body?.cancel(); } catch {}
        if (!probe.ok && probe.status !== 206) { if (!res.headersSent) res.status(probe.status||502).send(`Upstream MKV seek probe failed: ${probe.status}`); return true; }
      } catch (e:any) { console.warn(`MKV seek probe failed, using linear fallback: ${e?.message||e}`); }
      if (ranges) {
        const args=["-hide_banner","-loglevel","info","-nostdin","-ss",String(start),"-user_agent",h["User-Agent"]||PROVIDER_USER_AGENT,...(h.Referer?["-referer",h.Referer]:[]),...(ffHeaders?["-headers",`${ffHeaders}\r\n`]:[]),"-seekable","1","-rw_timeout","120000000","-i",finalUrl,...outputArgs()];
        console.log(`Starting direct MKV FFmpeg seek: start=${start}s session=${session||"none"} playback=${playback||"none"} url=${finalUrl}`);
        return directFfmpeg(args,res,start,"range",session,playback);
      }
      console.warn(`Provider did not confirm ranges; linear seek fallback at ${start}s`);
    }
    let upstream: Response;
    try { console.log(`Fetching MKV upstream before FFmpeg: ${url}`); upstream=await fetch(url,{method:"GET",headers:h,redirect:"follow"}); }
    catch(e:any){ if(!res.headersSent)res.status(502).send(`Upstream MKV connection failed: ${e?.message||e}`); return true; }
    console.log(`MKV upstream response: status=${upstream.status} type=${upstream.headers.get("content-type")||"unknown"} length=${upstream.headers.get("content-length")||"unknown"} finalUrl=${upstream.url||url}`);
    if(!upstream.ok||!upstream.body){if(!res.headersSent)res.status(upstream.status||502).send(`Upstream MKV error: ${upstream.status}`);return true;}
    const ff=spawn(ffmpegPath,["-hide_banner","-loglevel","info","-nostdin","-i","pipe:0",...(start>0?["-ss",String(start)]:[]),...outputArgs()],{stdio:["pipe","pipe","pipe"]});
    const readable=Readable.fromWeb(upstream.body as any); let stderr="",output=false,stopped=false,timer:NodeJS.Timeout|null=null;
    const stop:StopFn=reason=>{if(stopped)return;stopped=true;if(timer)clearTimeout(timer);console.log(`Pipe FFmpeg stop session=${session||"none"} playback=${playback||"none"}: ${reason}`);try{readable.destroy();}catch{}try{ff.stdin.destroy();}catch{}try{ff.stdout.destroy();}catch{}try{if(!ff.killed)ff.kill("SIGKILL");}catch{}if(!res.writableEnded&&!res.destroyed)try{res.end();}catch{}};
    register(session,playback,stop);transcodeHeaders(res,start,start>0?"mkv-to-mp4-linear-seek":"mkv-to-mp4-node-fetch",session,playback);
    ff.stderr.on("data",c=>{const s=c.toString();stderr+=s;console.log(`FFmpeg MKV: ${s.trimEnd()}`);}); ff.stdout.on("data",()=>{if(!output){output=true;if(timer)clearTimeout(timer);console.log(`FFmpeg MKV produced first MP4 output bytes session=${session||"none"} playback=${playback||"none"}`);}});
    ff.on("error",e=>{if(!stopped)console.warn("FFmpeg MKV spawn error:",e.message);if(!res.writableEnded&&!res.destroyed)res.end();}); ff.stdin.on("error",e=>{if(!stopped)console.warn("FFmpeg MKV stdin error:",e.message);}); ff.on("close",code=>{if(timer)clearTimeout(timer);clearActive(session,playback);console.log(`FFmpeg MKV exited code=${code} output=${output} stopped=${stopped}; ${stderr.trim().slice(-2500)||"no diagnostics"}`);if(!res.writableEnded&&!res.destroyed)res.end();});
    timer=setTimeout(()=>{if(!output&&!stopped)stop(`no output in 30s: ${stderr.trim().slice(-1500)||"none"}`);},30000); readable.on("error",(e:any)=>{if(!stopped)console.warn("MKV upstream body error:",e.message);try{ff.stdin.destroy(e);}catch{}}).pipe(ff.stdin);ff.stdout.pipe(res);res.on("close",()=>{clearActive(session,playback);stop("client response closed");});res.on("error",()=>{clearActive(session,playback);stop("client response error");});return true;
  }

  app.post("/api/xtream/stop",(req,res)=>{const{session,playback}=identity(req);if(!session)return res.status(400).json({error:"Missing session"});const stopped=stopActive(session,playback||undefined,"explicit player stop");res.json({stopped,session,playback:playback||null});});
  app.get("/api/xtream/proxy",async(req,res)=>{try{const url=String(req.query.url||"");const err=validate(url);if(err)return res.status(400).json({error:err});const r=await fetch(url,{headers:upstreamHeaders(req),redirect:"follow",signal:AbortSignal.timeout(120000)});res.writeHead(r.status,{"Content-Type":contentType(r.headers.get("content-type"),"application/json; charset=utf-8")});if(!r.body)return res.end();Readable.fromWeb(r.body as any).pipe(res);}catch(e:any){if(!res.headersSent)res.status(502).json({error:"Failed to connect to IPTV server",details:e.message});}});

  app.all("/api/xtream/stream",async(req,res)=>{
    if(req.method!=="GET"&&req.method!=="HEAD")return res.status(405).send("Method Not Allowed");
    try{
      const url=String(req.query.url||"");const err=validate(url);if(err)return res.status(400).send(err);const{session,playback}=identity(req);const isMkv=(()=>{try{return/\.mkv$/i.test(new URL(url).pathname);}catch{return false;}})();const n=Number(req.query.start);const start=isMkv&&Number.isFinite(n)?Math.max(0,n):0;
      if(req.method==="GET"&&isMkv&&session){stopActive(session,undefined,"new media GET for same player session");console.log(`Incoming MKV playback session=${session} playback=${playback||"none"} start=${start}s`);}
      const extra:Record<string,string>={};if(!isMkv&&typeof req.headers.range==="string")extra.Range=req.headers.range;
      const fallback=mp4Fallback(url);if(fallback){const r=await fetch(fallback,{method:req.method,headers:upstreamHeaders(req,extra),redirect:"follow",signal:AbortSignal.timeout(120000)});if(r.ok){const h:Record<string,string>={"Content-Type":contentType(r.headers.get("content-type"),"video/mp4"),"Accept-Ranges":r.headers.get("accept-ranges")||"bytes"};for(const k of["content-length","content-range","etag","last-modified","cache-control"]){const v=r.headers.get(k);if(v)h[k]=v;}res.writeHead(r.status,h);if(req.method==="HEAD"||!r.body)return res.end();const rd=Readable.fromWeb(r.body as any);res.on("close",()=>{try{rd.destroy();}catch{}});return rd.pipe(res);}console.log(`MP4 variant unavailable (${r.status}); using MKV FFmpeg: ${url}`);}
      if(isMkv){if(req.method==="HEAD"){const r=await fetch(url,{method:"HEAD",headers:upstreamHeaders(req),redirect:"follow",signal:AbortSignal.timeout(120000)});if(!r.ok)return res.status(r.status).end();return res.writeHead(r.status,{"Content-Type":contentType(r.headers.get("content-type"),"video/x-matroska"),"Accept-Ranges":r.headers.get("accept-ranges")||"bytes"}).end();}if(await transcodeMkv(url,req,res,start,session,playback))return;}
      const r=await fetch(url,{method:req.method,headers:upstreamHeaders(req,extra),redirect:"follow",signal:AbortSignal.timeout(120000)});if(!r.ok&&r.status>=400)return res.status(r.status).send(`Upstream stream error: ${r.status}`);const lower=(r.url||url).toLowerCase();const m3u8=lower.includes(".m3u8")||lower.includes("type=m3u_plus");const ct=contentType(r.headers.get("content-type"),m3u8?"application/vnd.apple.mpegurl":lower.includes(".ts")?"video/mp2t":lower.includes(".webm")?"video/webm":"video/mp4");if((m3u8||ct.includes("mpegurl"))&&req.method==="GET"){const body=rewriteM3u8(await r.text(),r.url||url,req);res.writeHead(r.status,{"Content-Type":"application/vnd.apple.mpegurl","Content-Length":Buffer.byteLength(body),"Cache-Control":"no-cache,no-store"});return res.end(body);}const h:Record<string,string>={"Content-Type":ct,"Accept-Ranges":r.headers.get("accept-ranges")||"bytes"};for(const k of["content-length","content-range","etag","last-modified","cache-control"]){const v=r.headers.get(k);if(v)h[k]=v;}res.writeHead(r.status,h);if(req.method==="HEAD"||!r.body)return res.end();const rd=Readable.fromWeb(r.body as any);res.on("close",()=>{try{rd.destroy();}catch{}});rd.pipe(res);
    }catch(e:any){console.error("Proxy stream error:",e.stack||e);if(!res.headersSent)res.status(502).send("Upstream stream proxy error: "+(e.message||e));}
  });

  app.get("/api/health",(_req,res)=>res.json({status:"ok",device:"webos-iptv-player",ffmpegAvailable:!!ffmpegPath,activeTranscodes:active.size,upstreamUserAgent:PROVIDER_USER_AGENT}));
  if(process.env.NODE_ENV!=="production"){const vite=await createViteServer({server:{middlewareMode:true},appType:"spa"});app.use(vite.middlewares);}else{const dist=path.join(process.cwd(),"dist");app.use(express.static(dist));app.get("*",(_req,res)=>res.sendFile(path.join(dist,"index.html")));}
  app.listen(PORT,"0.0.0.0",()=>console.log(`WebOS Xtream IPTV server running on http://0.0.0.0:${PORT}`));
}
startServer();