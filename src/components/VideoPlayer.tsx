import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  Clapperboard,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ContentItem, Episode, PlaybackProgress } from '../types';

interface VideoPlayerProps {
  item: ContentItem;
  streamUrl: string;
  initialTime?: number;
  seriesContext?: {
    seriesId: number;
    seasonNum: number;
    episode: Episode;
    allEpisodes?: Episode[];
  };
  onClose: () => void;
  onUpdateProgress: (progress: PlaybackProgress) => void;
  onSelectEpisode?: (episode: Episode, seasonNum: number) => void;
  onEpisodeEnded?: (episode: Episode, seasonNum: number) => void;
  getEpisodeProgress?: (
    seriesId: number,
    seasonNum: number,
    episodeNum: number,
    episodeId?: string | number
  ) => PlaybackProgress | null;
  isEpisodeWatched?: (seriesId: number, seasonNum: number, episodeNum: number) => boolean;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function getProxyUpstreamUrl(value: string): URL | null {
  const parsed = parseUrl(value);
  if (!parsed || !parsed.pathname.endsWith('/api/xtream/stream')) return null;
  const upstream = parsed.searchParams.get('url');
  if (!upstream) return null;
  try {
    return new URL(upstream);
  } catch {
    return null;
  }
}

function isTranscodedMkvUrl(value: string): boolean {
  const upstream = getProxyUpstreamUrl(value);
  return !!upstream && /\.mkv$/i.test(upstream.pathname);
}

function getSourceStart(value: string): number {
  const parsed = parseUrl(value);
  if (!parsed) return 0;
  const start = Number(parsed.searchParams.get('start') || '0');
  return Number.isFinite(start) && start > 0 ? start : 0;
}

function withStart(value: string, seconds: number): string {
  const parsed = parseUrl(value);
  if (!parsed) return value;
  const target = Math.max(0, Math.floor(seconds));
  if (target > 0) parsed.searchParams.set('start', String(target));
  else parsed.searchParams.delete('start');
  parsed.searchParams.delete('_r');
  parsed.searchParams.delete('_t');
  return parsed.toString();
}

function withPlaybackIdentity(value: string, session: string, playback: string): string {
  const parsed = parseUrl(value);
  if (!parsed || !parsed.pathname.endsWith('/api/xtream/stream')) return value;
  parsed.searchParams.set('session', session);
  parsed.searchParams.set('playback', playback);
  return parsed.toString();
}

function toHlsPlaybackUrl(value: string): string {
  const parsed = parseUrl(value);
  const upstream = getProxyUpstreamUrl(value);
  if (!parsed || !upstream || !/\.mkv$/i.test(upstream.pathname)) return value;

  const session = parsed.searchParams.get('session');
  const playback = parsed.searchParams.get('playback');
  if (!session || !playback) return value;

  const hls = new URL(
    `/api/xtream/hls/${encodeURIComponent(session)}/${encodeURIComponent(playback)}/index.m3u8`,
    parsed.origin
  );
  hls.searchParams.set('url', upstream.toString());
  for (const key of ['start', 'ua', 'referer', 'origin']) {
    const parameter = parsed.searchParams.get(key);
    if (parameter) hls.searchParams.set(key, parameter);
  }
  return hls.toString();
}

function createSessionId(): string {
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isHlsUrl(value: string, isLive: boolean): boolean {
  if (value.includes('.m3u8')) return true;
  if (isLive && !/\.(mp4|mkv|webm|avi)(?:\?|$)/i.test(value)) return true;
  return false;
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function getKnownDuration(item: ContentItem, seriesContext?: VideoPlayerProps['seriesContext']): number {
  const itemAny = item as any;
  const candidates = [
    seriesContext?.episode?.info?.duration_secs,
    seriesContext?.episode?.info?.duration,
    itemAny.duration_secs,
    itemAny.duration_sec,
    itemAny.duration,
  ];

  for (const candidate of candidates) {
    const seconds = parseDurationSeconds(candidate);
    if (seconds > 0) return seconds;
  }
  return 0;
}

const durationLookupCache = new Map<string, number>();

async function lookupXtreamDuration(
  value: string,
  seriesContext?: VideoPlayerProps['seriesContext']
): Promise<number> {
  const source = parseUrl(value);
  const upstream = getProxyUpstreamUrl(value);
  if (!source || !upstream) return 0;

  const cacheKey = upstream.toString();
  if (durationLookupCache.has(cacheKey)) return durationLookupCache.get(cacheKey) || 0;

  try {
    const parts = upstream.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return 0;
    const section = parts[0].toLowerCase();
    const username = parts[1];
    const password = parts[2];
    const mediaId = parts[3].replace(/\.[^.]+$/, '');
    if (!username || !password || !mediaId) return 0;

    const apiUrl = new URL('/player_api.php', upstream.origin);
    apiUrl.searchParams.set('username', username);
    apiUrl.searchParams.set('password', password);

    if (section === 'movie') {
      apiUrl.searchParams.set('action', 'get_vod_info');
      apiUrl.searchParams.set('vod_id', mediaId);
    } else if (section === 'series' && seriesContext?.seriesId) {
      apiUrl.searchParams.set('action', 'get_series_info');
      apiUrl.searchParams.set('series_id', String(seriesContext.seriesId));
    } else {
      durationLookupCache.set(cacheKey, 0);
      return 0;
    }

    const proxy = new URL('/api/xtream/proxy', source.origin);
    proxy.searchParams.set('url', apiUrl.toString());
    const response = await fetch(proxy.toString(), { cache: 'no-store' });
    if (!response.ok) {
      durationLookupCache.set(cacheKey, 0);
      return 0;
    }

    const data = await response.json();
    let seconds = 0;
    if (section === 'movie') {
      seconds = parseDurationSeconds(
        data?.info?.duration_secs ?? data?.info?.duration_sec ?? data?.info?.duration
      );
    } else {
      const groups = data?.episodes && typeof data.episodes === 'object'
        ? Object.values(data.episodes)
        : [];
      const episodes = groups.flatMap((group: any) => Array.isArray(group) ? group : []);
      const episode = episodes.find((entry: any) => String(entry?.id) === String(mediaId));
      seconds = parseDurationSeconds(
        episode?.info?.duration_secs ?? episode?.info?.duration ?? episode?.duration
      );
    }

    durationLookupCache.set(cacheKey, seconds > 0 ? seconds : 0);
    return seconds > 0 ? seconds : 0;
  } catch (error) {
    console.warn('Duration lookup notice:', error);
    durationLookupCache.set(cacheKey, 0);
    return 0;
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function hardStopVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  try { video.pause(); } catch {}
  try {
    video.removeAttribute('src');
    video.load();
  } catch {}
}

function stopPlaybackUrl(value: string) {
  const parsed = parseUrl(value);
  if (!parsed || !parsed.pathname.endsWith('/api/xtream/stream')) return;
  const session = parsed.searchParams.get('session');
  const playback = parsed.searchParams.get('playback');
  if (!session || !playback) return;

  try {
    const stopUrl = new URL('/api/xtream/stop', parsed.origin);
    stopUrl.searchParams.set('session', session);
    stopUrl.searchParams.set('playback', playback);
    void fetch(stopUrl.toString(), {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  item,
  streamUrl,
  initialTime = 0,
  seriesContext,
  onClose,
  onUpdateProgress,
  onSelectEpisode,
  onEpisodeEnded,
  getEpisodeProgress,
  isEpisodeWatched,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const resumeAfterSourceChangeRef = useRef(true);
  const initialNativeSeekRef = useRef(Math.max(0, initialTime));
  const progressRef = useRef<() => void>(() => {});
  const sessionRef = useRef(createSessionId());
  const playbackCounterRef = useRef(0);

  const [activeUrl, setActiveUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => getKnownDuration(item, seriesContext));
  const [buffered, setBuffered] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<{ id: number; label: string; language: string }[]>([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(-1);

  const isLive = item.type === 'live';
  const isSeries = item.type === 'series' || !!seriesContext;
  const metadataDuration = getKnownDuration(item, seriesContext);

  const buildPlaybackUrl = useCallback((baseUrl: string, startSeconds?: number) => {
    let next = baseUrl;
    if (typeof startSeconds === 'number' && isTranscodedMkvUrl(baseUrl)) {
      next = withStart(baseUrl, startSeconds);
    }
    const playback = String(++playbackCounterRef.current);
    return withPlaybackIdentity(next, sessionRef.current, playback);
  }, []);

  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const result = video.play();
      if (result) {
        playPromiseRef.current = result;
        result
          .then(() => {
            if (playPromiseRef.current === result) playPromiseRef.current = null;
            setIsPlaying(true);
            setIsBuffering(false);
            setPlaybackError(null);
          })
          .catch((error) => {
            if (playPromiseRef.current === result) playPromiseRef.current = null;
            if (error?.name === 'AbortError') return;
            console.warn('Playback play() notice:', error?.message || error);
          });
      }
    } catch (error: any) {
      console.warn('Synchronous play() call error:', error?.message || error);
    }
  }, []);

  const safePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try { video.pause(); } catch {}
    setIsPlaying(false);
  }, []);

  const updateDurationFromMedia = useCallback(() => {
    if (isTranscodedMkvUrl(activeUrl)) {
      if (metadataDuration > 0) setDuration(metadataDuration);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const mediaDuration = Number(video.duration);
    if (Number.isFinite(mediaDuration) && mediaDuration > 0) setDuration(mediaDuration);
    else if (metadataDuration > 0) setDuration(metadataDuration);
  }, [activeUrl, metadataDuration]);

  useEffect(() => {
    const next = buildPlaybackUrl(streamUrl, initialTime > 0 ? initialTime : undefined);
    initialNativeSeekRef.current = isTranscodedMkvUrl(next) ? 0 : Math.max(0, initialTime);
    resumeAfterSourceChangeRef.current = true;
    setActiveUrl(next);
    setCurrentTime(isTranscodedMkvUrl(next) ? getSourceStart(next) : 0);
    setBuffered(0);
    setDuration(getKnownDuration(item, seriesContext));
    setPlaybackError(null);
    setIsBuffering(true);
  }, [buildPlaybackUrl, initialTime, item.id, metadataDuration, seriesContext?.episode?.id, streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeUrl) return;

    const mediaUrl = isTranscodedMkvUrl(activeUrl) ? toHlsPlaybackUrl(activeUrl) : activeUrl;
    const shouldResume = resumeAfterSourceChangeRef.current;
    let hls: Hls | null = null;
    let metadataHandler: (() => void) | null = null;

    setIsBuffering(true);
    setPlaybackError(null);

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }

    const onReady = () => {
      updateDurationFromMedia();
      if (!isTranscodedMkvUrl(activeUrl) && initialNativeSeekRef.current > 0) {
        const target = initialNativeSeekRef.current;
        initialNativeSeekRef.current = 0;
        try { video.currentTime = target; } catch {}
      }

      const tracks = Array.from(video.textTracks || []).map((track: TextTrack, id) => ({
        id,
        label: track.label || `Track ${id + 1}`,
        language: track.language || '',
      }));
      setSubtitleTracks(tracks);

      if (shouldResume) safePlay();
      else safePause();
    };

    const hlsMedia = isHlsUrl(mediaUrl, isLive);
    const nativeHls = hlsMedia && !!video.canPlayType('application/vnd.apple.mpegurl');

    if (nativeHls) {
      metadataHandler = onReady;
      video.addEventListener('loadedmetadata', metadataHandler, { once: true });
      video.preload = 'auto';
      video.src = mediaUrl;
      video.load();
      console.log(`Native HLS playback: ${mediaUrl}`);
    } else if (hlsMedia && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 15,
        maxBufferHole: 0.8,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(mediaUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, onReady);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try { hls?.startLoad(); } catch {}
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls?.recoverMediaError(); } catch {}
        } else {
          setPlaybackError(`HLS playback failed: ${data.details || 'unknown error'}`);
          setIsBuffering(false);
        }
      });
      console.log(`hls.js playback: ${mediaUrl}`);
    } else {
      metadataHandler = onReady;
      video.addEventListener('loadedmetadata', metadataHandler, { once: true });
      video.preload = 'auto';
      video.src = mediaUrl;
      video.load();
    }

    return () => {
      if (metadataHandler) video.removeEventListener('loadedmetadata', metadataHandler);
      if (hls) {
        try { hls.destroy(); } catch {}
        if (hlsRef.current === hls) hlsRef.current = null;
      }
      stopPlaybackUrl(activeUrl);
      hardStopVideo(video);
    };
  }, [activeUrl, isLive, safePause, safePlay, updateDurationFromMedia]);

  useEffect(() => {
    if (!activeUrl || !isTranscodedMkvUrl(activeUrl) || duration > 0) return;
    let cancelled = false;
    void lookupXtreamDuration(activeUrl, seriesContext).then((seconds) => {
      if (!cancelled && seconds > 0) setDuration(seconds);
    });
    return () => { cancelled = true; };
  }, [activeUrl, duration, seriesContext?.seriesId]);

  const logicalCurrentTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return currentTime;
    const raw = Number(video.currentTime);
    if (!Number.isFinite(raw)) return currentTime;
    return isTranscodedMkvUrl(activeUrl) ? getSourceStart(activeUrl) + raw : raw;
  }, [activeUrl, currentTime]);

  const recordProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isLive) {
      onUpdateProgress({
        id: item.id,
        type: 'live',
        title: item.name,
        poster: item.icon,
        timestamp: 1,
        duration: 1,
        streamUrl: activeUrl,
        lastUpdated: Date.now(),
      });
      return;
    }

    const timestamp = logicalCurrentTime();
    let knownDuration = duration;
    if (!isTranscodedMkvUrl(activeUrl)) {
      const mediaDuration = Number(video.duration);
      if (Number.isFinite(mediaDuration) && mediaDuration > 0) knownDuration = mediaDuration;
    }
    if (!(timestamp > 0) || !(knownDuration > 0)) return;

    onUpdateProgress({
      id: isSeries && seriesContext ? seriesContext.episode.id : item.id,
      type: item.type,
      title: item.name,
      subtitle: isSeries && seriesContext
        ? `Season ${seriesContext.seasonNum} Episode ${seriesContext.episode.episode_num}`
        : undefined,
      poster: item.icon,
      timestamp,
      duration: knownDuration,
      streamUrl: activeUrl,
      seriesId: seriesContext?.seriesId,
      seasonNum: seriesContext?.seasonNum,
      episodeId: seriesContext?.episode.id,
      episodeNum: seriesContext?.episode.episode_num,
      lastUpdated: Date.now(),
    });
  }, [activeUrl, duration, isLive, isSeries, item, logicalCurrentTime, onUpdateProgress, seriesContext]);

  useEffect(() => { progressRef.current = recordProgress; }, [recordProgress]);
  useEffect(() => {
    const timer = window.setInterval(() => progressRef.current(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const seekToPosition = useCallback((requestedSeconds: number) => {
    const video = videoRef.current;
    if (!video || isLive || !Number.isFinite(requestedSeconds)) return;

    const upper = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    const target = Math.max(0, Math.min(upper, requestedSeconds));
    const wasPlaying = !video.paused;

    if (isTranscodedMkvUrl(activeUrl)) {
      const currentAbsolute = logicalCurrentTime();
      if (Math.abs(currentAbsolute - target) < 0.75) return;
      resumeAfterSourceChangeRef.current = wasPlaying;
      const nextUrl = buildPlaybackUrl(activeUrl, target);
      setCurrentTime(target);
      setBuffered(target);
      setIsBuffering(true);
      setPlaybackError(null);
      setActiveUrl(nextUrl);
      setSeekFeedback(`${target >= currentAbsolute ? '+' : '-'}${Math.round(Math.abs(target - currentAbsolute))}s`);
      window.setTimeout(() => setSeekFeedback(null), 1000);
      console.log(`Transcoded VOD HLS source switch: target=${Math.floor(target)}s url=${nextUrl}`);
      return;
    }

    try {
      video.currentTime = target;
      setCurrentTime(target);
    } catch {}
  }, [activeUrl, buildPlaybackUrl, duration, isLive, logicalCurrentTime]);

  const handleSeek = useCallback((delta: number) => {
    seekToPosition(currentTime + delta);
    setSeekFeedback(`${delta >= 0 ? '+' : ''}${delta}s`);
    window.setTimeout(() => setSeekFeedback(null), 1000);
  }, [currentTime, seekToPosition]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) safePlay();
    else {
      safePause();
      recordProgress();
    }
  }, [recordProgress, safePause, safePlay]);

  const closePlayer = useCallback(() => {
    progressRef.current();
    stopPlaybackUrl(activeUrl);
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    hardStopVideo(videoRef.current);
    onClose();
  }, [activeUrl, onClose]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const raw = Number(video.currentTime);
    if (!Number.isFinite(raw)) return;

    const start = isTranscodedMkvUrl(activeUrl) ? getSourceStart(activeUrl) : 0;
    const absolute = start + raw;
    setCurrentTime(absolute);

    if (video.buffered.length > 0) {
      const rawEnd = video.buffered.end(video.buffered.length - 1);
      setBuffered(start + rawEnd);
    }

    updateDurationFromMedia();
    if (absolute > start + 0.05) setIsBuffering(false);
  }, [activeUrl, updateDurationFromMedia]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.keyCode || event.which;
      if (code === 27 || code === 461 || code === 10009 || event.key === 'Escape' || event.key === 'BrowserBack') {
        event.preventDefault(); closePlayer(); return;
      }
      if (code === 32 || code === 415 || code === 19) {
        event.preventDefault(); togglePlay(); return;
      }
      if (!isLive && (code === 37 || code === 412)) {
        event.preventDefault(); handleSeek(-10); return;
      }
      if (!isLive && (code === 39 || code === 417)) {
        event.preventDefault(); handleSeek(10);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closePlayer, handleSeek, isLive, togglePlay]);

  const nextEpisode = isSeries && seriesContext?.allEpisodes
    ? seriesContext.allEpisodes.find((episode) => episode.episode_num === seriesContext.episode.episode_num + 1)
    : null;

  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const bufferPercent = duration > 0 ? Math.max(0, Math.min(100, (buffered / duration) * 100)) : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
      onMouseMove={() => setShowControls(true)}
      onClick={() => setShowControls(true)}
    >
      {activeUrl && (
        <video
          key={activeUrl}
          ref={videoRef}
          id="webos-hardware-video"
          className="w-full h-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={updateDurationFromMedia}
          onLoadStart={() => setIsBuffering(true)}
          onWaiting={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          onPlaying={() => {
            setIsBuffering(false);
            setIsPlaying(true);
            setPlaybackError(null);
          }}
          onPause={() => setIsPlaying(false)}
          onError={(event) => {
            const video = event.currentTarget;
            const error = video.error;
            if (error?.code === MediaError.MEDIA_ERR_ABORTED) return;
            const detail = error?.message || `media error ${error?.code || 'unknown'}`;
            console.warn('Video element playback error:', detail, 'src=', video.currentSrc || activeUrl);
            setIsBuffering(false);
            setIsPlaying(false);
            setPlaybackError(`The media stream could not be loaded (${detail}).`);
          }}
          onEnded={() => {
            recordProgress();
            if (isSeries && nextEpisode && onSelectEpisode && seriesContext) {
              onSelectEpisode(nextEpisode, seriesContext.seasonNum);
            } else if (isSeries && seriesContext && onEpisodeEnded) {
              onEpisodeEnded(seriesContext.episode, seriesContext.seasonNum);
            }
          }}
          playsInline
          // @ts-ignore
          webos-media-playback="true"
        />
      )}

      {isBuffering && !playbackError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="rounded-xl border border-slate-700 bg-black/90 px-5 py-3 text-sm font-semibold text-slate-200">
            Buffering stream...
          </div>
        </div>
      )}

      {playbackError && (
        <div className="absolute inset-0 z-40 bg-black/95 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-2xl border border-rose-500/40 bg-slate-950 p-6 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
            <h3 className="text-xl font-bold text-white">Playback Error</h3>
            <p className="text-sm text-slate-300">{playbackError}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  resumeAfterSourceChangeRef.current = true;
                  setPlaybackError(null);
                  setIsBuffering(true);
                  setActiveUrl((previous) => buildPlaybackUrl(previous, getSourceStart(previous)));
                }}
                className="px-4 py-2 rounded-lg bg-sky-500 text-white font-semibold"
              >Retry</button>
              <button onClick={closePlayer} className="px-4 py-2 rounded-lg bg-slate-800 text-white font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}

      {seekFeedback && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
          <div className="rounded-xl border border-sky-500/50 bg-black/85 px-6 py-4 text-xl font-bold text-white">
            {seekFeedback}
          </div>
        </div>
      )}

      <div className={`absolute top-0 inset-x-0 z-30 p-5 bg-gradient-to-b from-black/95 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={closePlayer} className="p-2 rounded-lg bg-slate-900/80 border border-slate-700 text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h2 className="font-bold text-white truncate">{item.name}</h2>
              {seriesContext && (
                <div className="text-xs text-sky-300">
                  Season {seriesContext.seasonNum} · Episode {seriesContext.episode.episode_num}
                </div>
              )}
            </div>
          </div>

          {isSeries && seriesContext?.allEpisodes && seriesContext.allEpisodes.length > 0 && (
            <button
              onClick={() => setShowEpisodes((value) => !value)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/80 border border-slate-700 text-white text-sm"
            >
              <Clapperboard className="w-4 h-4" /> Episodes
            </button>
          )}
        </div>
      </div>

      {showEpisodes && isSeries && seriesContext?.allEpisodes && (
        <div className="absolute top-20 right-5 z-40 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/95 p-3 space-y-2">
          {seriesContext.allEpisodes.map((episode) => {
            const watched = isEpisodeWatched
              ? isEpisodeWatched(seriesContext.seriesId, seriesContext.seasonNum, episode.episode_num)
              : false;
            const progress = getEpisodeProgress
              ? getEpisodeProgress(seriesContext.seriesId, seriesContext.seasonNum, episode.episode_num, episode.id)
              : null;
            return (
              <button
                key={episode.id}
                onClick={() => {
                  onSelectEpisode?.(episode, seriesContext.seasonNum);
                  setShowEpisodes(false);
                }}
                className="w-full text-left rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-white"
              >
                <div className="font-semibold">Episode {episode.episode_num}</div>
                <div className="text-xs text-slate-400">
                  {watched ? 'Watched' : progress && progress.duration > 0 ? `${Math.round((progress.timestamp / progress.duration) * 100)}% watched` : 'Not started'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className={`absolute bottom-0 inset-x-0 z-30 p-5 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {!isLive && (
          <div className="mb-4">
            <div
              className={`relative h-3 rounded-full bg-slate-800 overflow-hidden ${duration > 0 ? 'cursor-pointer' : 'cursor-wait opacity-70'}`}
              onClick={(event) => {
                if (!(duration > 0)) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                seekToPosition(ratio * duration);
              }}
            >
              <div className="absolute inset-y-0 left-0 bg-slate-600/60" style={{ width: `${bufferPercent}%` }} />
              <div className="absolute inset-y-0 left-0 bg-sky-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs font-mono text-slate-300">
              <span>{formatTime(currentTime)}</span>
              <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="w-11 h-11 rounded-xl bg-sky-500 text-white flex items-center justify-center">
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            {!isLive && (
              <>
                <button onClick={() => handleSeek(-10)} className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-white flex items-center gap-1 text-sm">
                  <RotateCcw className="w-4 h-4" /> 10s
                </button>
                <button onClick={() => handleSeek(10)} className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-white flex items-center gap-1 text-sm">
                  <RotateCw className="w-4 h-4" /> 10s
                </button>
              </>
            )}

            <button
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                video.muted = !video.muted;
                setIsMuted(video.muted);
              }}
              className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-white"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          {subtitleTracks.length > 0 && (
            <div className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-slate-300" />
              <select
                value={selectedSubtitleTrack}
                onChange={(event) => {
                  const selected = Number(event.target.value);
                  setSelectedSubtitleTrack(selected);
                  const video = videoRef.current;
                  if (!video?.textTracks) return;
                  for (let index = 0; index < video.textTracks.length; index++) {
                    video.textTracks[index].mode = index === selected ? 'showing' : 'disabled';
                  }
                }}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white"
              >
                <option value={-1}>Subtitles off</option>
                {subtitleTracks.map((track) => (
                  <option key={track.id} value={track.id}>{track.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
