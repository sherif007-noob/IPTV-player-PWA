import fs from 'node:fs';

const videoPath = 'src/components/VideoPlayer.tsx';
const serverPath = 'server.ts';

let video = fs.readFileSync(videoPath, 'utf8');
let server = fs.readFileSync(serverPath, 'utf8');

const marker = "  const [activeUrl, setActiveUrl] = useState<string>(streamUrl);";
if (!video.includes(marker)) throw new Error('activeUrl marker not found');
video = video.replace(marker, `${marker}\n  const pendingSourceUrlRef = useRef<string | null>(null);\n  const [sourceRevision, setSourceRevision] = useState(0);`);

const syncBlock = `  useEffect(() => {\n    setActiveUrl(streamUrl);\n    setPlaybackError(null);\n    setBufferingSeconds(0);\n    hlsNetworkRetryCount.current = 0;\n    hlsMediaRetryCount.current = 0;\n  }, [streamUrl]);`;
const syncReplacement = `  useEffect(() => {\n    pendingSourceUrlRef.current = null;\n    setActiveUrl(streamUrl);\n    setPlaybackError(null);\n    setBufferingSeconds(0);\n    hlsNetworkRetryCount.current = 0;\n    hlsMediaRetryCount.current = 0;\n  }, [streamUrl]);`;
if (!video.includes(syncBlock)) throw new Error('streamUrl sync block not found');
video = video.replace(syncBlock, syncReplacement);

const effectStart = `  useEffect(() => {\n    const video = videoRef.current;\n    if (!video || !activeUrl) return;\n\n    let hls: Hls | null = null;`;
const effectStartReplacement = `  useEffect(() => {\n    const video = videoRef.current;\n    const sourceUrl = pendingSourceUrlRef.current || activeUrl;\n    if (!video || !sourceUrl) return;\n    pendingSourceUrlRef.current = null;\n\n    let hls: Hls | null = null;`;
if (!video.includes(effectStart)) throw new Error('media effect start not found');
video = video.replace(effectStart, effectStartReplacement);

video = video.replace(/const isMp4OrWebm = activeUrl\.endsWith\('\.mp4'\) \|\| activeUrl\.endsWith\('\.webm'\);/g, "const isMp4OrWebm = /\\.(mp4|webm)(?:\\?|$)/i.test(sourceUrl);");
video = video.replace(/activeUrl\.includes\('\.m3u8'\)/g, "sourceUrl.includes('.m3u8')");
video = video.replace(/activeUrl\.includes\('\/live\/'\)/g, "sourceUrl.includes('/live/')");
video = video.replace(/hls\.loadSource\(activeUrl\)/g, "hls.loadSource(sourceUrl)");
video = video.replace(/video\.src = activeUrl;/g, "video.src = sourceUrl;");
video = video.replace(/  \}, \[activeUrl, isLive, safePlay, safePause, restartHlsStream\]\);/, "  }, [activeUrl, sourceRevision, isLive, safePlay, safePause, restartHlsStream]);");

const seekStart = '  const seekToPosition = useCallback(\n';
const seekEnd = "  );\n\n  // 10-Second Seek Handler";
const a = video.indexOf(seekStart);
const b = video.indexOf(seekEnd, a);
if (a < 0 || b < 0) throw new Error('seek helper boundaries not found');
const seekReplacement = `  const seekToPosition = useCallback(\n    (targetSeconds: number) => {\n      const video = videoRef.current;\n      if (!video || isLive || !Number.isFinite(targetSeconds)) return false;\n\n      const target = Math.max(0, Math.floor(targetSeconds));\n      let parsed: URL;\n      try {\n        parsed = new URL(activeUrl, window.location.href);\n      } catch {\n        return false;\n      }\n\n      if (!parsed.pathname.endsWith('/api/xtream/stream')) return false;\n      const upstream = parsed.searchParams.get('url');\n      if (!upstream) return false;\n      try {\n        if (!/\\.mkv$/i.test(new URL(upstream).pathname)) return false;\n      } catch {\n        return false;\n      }\n\n      const currentStart = Number(parsed.searchParams.get('start') || '0');\n      if (Number.isFinite(currentStart) && Math.abs(currentStart - target) < 1) return true;\n\n      const wasPaused = video.paused;\n      const seekUrl = new URL(parsed.toString());\n      seekUrl.searchParams.set('start', String(target));\n      seekUrl.searchParams.delete('_r');\n      seekUrl.searchParams.delete('_t');\n      const nextUrl = seekUrl.toString();\n\n      pendingSourceUrlRef.current = nextUrl;\n      initialTimeRef.current = 0;\n      setCurrentTime(target);\n      setIsBuffering(true);\n      setPlaybackError(null);\n      setActiveUrl(nextUrl);\n      setSourceRevision((value) => value + 1);\n\n      setSeekFeedback((target > currentStart ? '+' : '-') + Math.abs(target - currentStart) + 's');\n      triggerControls();\n      setTimeout(() => setSeekFeedback(null), 1000);\n\n      if (wasPaused) {\n        const pauseAfterLoad = () => {\n          safePause();\n          video.removeEventListener('loadedmetadata', pauseAfterLoad);\n        };\n        video.addEventListener('loadedmetadata', pauseAfterLoad, { once: true });\n      }\n\n      console.log('Transcoded VOD seek: target=' + target + 's url=' + nextUrl);\n      return true;\n    },\n    [activeUrl, isLive, safePause, triggerControls]\n  );\n`;
video = video.slice(0, a) + seekReplacement + video.slice(b + 3);

const currLine = '    const curr = videoRef.current.currentTime;\n    const dur = videoRef.current.duration || duration;';
const currReplacement = `    const rawCurr = videoRef.current.currentTime;\n    const sourceStart = Number(new URL(activeUrl, window.location.href).searchParams.get('start') || '0');\n    const curr = Number.isFinite(sourceStart) && sourceStart > 0 ? rawCurr + sourceStart : rawCurr;\n    const dur = videoRef.current.duration || duration;`;
if (!video.includes(currLine)) throw new Error('progress currentTime block not found');
video = video.replace(currLine, currReplacement);

const errorNeedle = "                if (activeUrl.includes('.mkv')) {\n                  console.warn('MKV playback failed, auto-switching to MP4 container fallback...');\n                  switchContainerExtension('mp4');\n                  return;\n                }";
const errorReplacement = `                if (activeUrl.includes('.mkv') && !activeUrl.includes('/api/xtream/stream')) {\n                  console.warn('Raw MKV playback failed, trying provider MP4 fallback...');\n                  switchContainerExtension('mp4');\n                  return;\n                }`;
if (!video.includes(errorNeedle)) throw new Error('MKV fallback block not found');
video = video.replace(errorNeedle, errorReplacement);

const timeoutFetch = 'upstream = await fetch(streamUrl, { method: "GET", headers: upstreamHeaders, redirect: "follow", signal: AbortSignal.timeout(30000) });';
const noTimeoutFetch = 'upstream = await fetch(streamUrl, { method: "GET", headers: upstreamHeaders, redirect: "follow" });';
if (!server.includes(timeoutFetch)) throw new Error('normal MKV fetch timeout not found');
server = server.replace(timeoutFetch, noTimeoutFetch);

const oldArgs = '"-http_seekable", "1", "-http_persistent", "0", "-rw_timeout", "30000000", "-i", streamUrl,';
const newArgs = '"-http_seekable", "1", "-http_persistent", "0", "-multiple_requests", "0", "-rw_timeout", "120000000", "-seek_timestamp", "1", "-i", streamUrl,';
if (!server.includes(oldArgs)) throw new Error('direct seek HTTP args not found');
server = server.replace(oldArgs, newArgs);

fs.writeFileSync(videoPath, video);
fs.writeFileSync(serverPath, server);
console.log('VOD seeking retrofit applied');
