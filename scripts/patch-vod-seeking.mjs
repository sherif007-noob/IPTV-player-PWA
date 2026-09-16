import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const playerPath = 'src/components/VideoPlayer.tsx';
const workflowPath = '.github/workflows/test.yml';

const player = fs.readFileSync(playerPath, 'utf8');

const oldSeek = `  // 10-Second Seek Handler (Arrow keys / Remote buttons)\n  const handleSeek = useCallback(\n    (offsetSeconds: number) => {\n      if (!videoRef.current || isLive) return;\n      const newTime = Math.max(\n        0,\n        Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + offsetSeconds)\n      );\n      videoRef.current.currentTime = newTime;\n      setCurrentTime(newTime);\n      setSeekFeedback(offsetSeconds > 0 ? \`+\${offsetSeconds}s\` : \`\${offsetSeconds}s\`);\n      triggerControls();\n\n      setTimeout(() => setSeekFeedback(null), 1000);\n    },\n    [isLive, triggerControls]\n  );`;

const newSeek = `  // Seek helper for transcoded MKV VOD/Series. The browser cannot seek inside the\n  // non-seekable fragmented-MP4 response, so restart the proxy at the requested\n  // absolute position and let the server perform an FFmpeg -ss seek upstream.\n  const seekToPosition = useCallback(\n    (targetSeconds: number) => {\n      const video = videoRef.current;\n      if (!video || isLive || !Number.isFinite(targetSeconds)) return false;\n\n      const target = Math.max(0, Math.floor(targetSeconds));\n      let parsed: URL;\n      try {\n        parsed = new URL(activeUrl, window.location.href);\n      } catch {\n        return false;\n      }\n\n      if (!parsed.pathname.endsWith('/api/xtream/stream')) return false;\n      const upstream = parsed.searchParams.get('url');\n      if (!upstream) return false;\n\n      try {\n        if (!/\\.mkv$/i.test(new URL(upstream).pathname)) return false;\n      } catch {\n        return false;\n      }\n\n      // Avoid reloading when the target is effectively the current transcoded start.\n      const currentStart = Number(parsed.searchParams.get('start') || '0');\n      if (Number.isFinite(currentStart) && Math.abs(currentStart - target) < 1) return true;\n\n      const wasPaused = video.paused;\n      parsed.searchParams.set('start', String(target));\n\n      // The activeUrl reload effect applies initialTimeRef after metadata. Clear it\n      // so a user seek is not immediately overwritten by the original resume point.\n      initialTimeRef.current = 0;\n      setCurrentTime(target);\n      setIsBuffering(true);\n      setPlaybackError(null);\n      setActiveUrl(parsed.toString());\n\n      setSeekFeedback(target > currentStart ? \`+\${target - currentStart}s\` : \`-\${currentStart - target}s\`);\n      triggerControls();\n      setTimeout(() => setSeekFeedback(null), 1000);\n\n      // Preserve pause/play state after the new source loads. The initialization\n      // effect already calls safePlay(), so explicitly pause only after metadata.\n      if (wasPaused) {\n        const pauseAfterLoad = () => {\n          safePause();\n          video.removeEventListener('loadedmetadata', pauseAfterLoad);\n        };\n        video.addEventListener('loadedmetadata', pauseAfterLoad);\n      }\n\n      console.log(\`Transcoded VOD seek: target=\${target}s url=\${parsed.toString()}\`);\n      return true;\n    },\n    [activeUrl, isLive, safePause, triggerControls]\n  );\n\n  // 10-Second Seek Handler (Arrow keys / Remote buttons)\n  const handleSeek = useCallback(\n    (offsetSeconds: number) => {\n      const video = videoRef.current;\n      if (!video || isLive) return;\n      const newTime = Math.max(\n        0,\n        Math.min(video.duration || 0, video.currentTime + offsetSeconds)\n      );\n\n      // For transcoded MKV VOD/Series, perform a server-side seek instead of\n      // assigning video.currentTime on a non-seekable live FFmpeg output.\n      if (seekToPosition(newTime)) return;\n\n      video.currentTime = newTime;\n      setCurrentTime(newTime);\n      setSeekFeedback(offsetSeconds > 0 ? \`+\${offsetSeconds}s\` : \`\${offsetSeconds}s\`);\n      triggerControls();\n      setTimeout(() => setSeekFeedback(null), 1000);\n    },\n    [isLive, seekToPosition, triggerControls]\n  );`;

if (!player.includes(oldSeek)) {
  throw new Error('Expected handleSeek block not found');
}

let updated = player.replace(oldSeek, newSeek);

const oldTimeline = `              onClick={(e) => {\n                const rect = e.currentTarget.getBoundingClientRect();\n                const pos = (e.clientX - rect.left) / rect.width;\n                if (videoRef.current && duration > 0) {\n                  videoRef.current.currentTime = pos * duration;\n                  setCurrentTime(pos * duration);\n                  triggerControls();\n                }\n              }}`;

const newTimeline = `              onClick={(e) => {\n                const rect = e.currentTarget.getBoundingClientRect();\n                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));\n                if (videoRef.current && duration > 0) {\n                  const target = pos * duration;\n                  if (!seekToPosition(target)) {\n                    videoRef.current.currentTime = target;\n                    setCurrentTime(target);\n                    triggerControls();\n                  }\n                }\n              }}`;

if (!updated.includes(oldTimeline)) {
  throw new Error('Expected timeline onClick block not found');
}
updated = updated.replace(oldTimeline, newTimeline);

fs.writeFileSync(playerPath, updated);

let workflow = fs.readFileSync(workflowPath, 'utf8');
workflow = workflow.replace(/\n      - name: Run temporary VOD seeking patch\n        run: node scripts\/patch-vod-seeking\.mjs\n/, '\n');
fs.writeFileSync(workflowPath, workflow);

fs.unlinkSync('scripts/patch-vod-seeking.mjs');

execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
execFileSync('git', ['add', playerPath, workflowPath, 'scripts/patch-vod-seeking.mjs']);
execFileSync('git', ['commit', '-m', 'fix: seek transcoded VOD from timeline and remote']);
execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
