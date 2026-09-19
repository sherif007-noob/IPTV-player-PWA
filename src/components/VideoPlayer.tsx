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

function canonicalProxyUrl(value: string): URL | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  if (parsed.pathname.endsWith('/api/xtream/stream') && parsed.searchParams.get('url')) return parsed;

  const wrapped = new URL('/api/xtream/stream', window.location.origin);
  wrapped.searchParams.set('url', parsed.toString());
  return wrapped;
}

function getUpstreamUrl(value: string): URL | null {
  const parsed = canonicalProxyUrl(value);
  const upstream = parsed?.searchParams.get('url');
  if (!upstream) return null;
  try {
    return new URL(upstream);
  } catch {
    return null;
  }
}

function isProviderHls(value: string): boolean {
  const upstream = getUpstreamUrl(value);
  if (!upstream) return false;
  return /\.m3u8$/i.test(upstream.pathname) || upstream.searchParams.get('type') === 'm3u_plus';
}

function usesGeneratedHls(value: string): boolean {
  const upstream = getUpstreamUrl(value);
  return !!upstream && /\.mkv$/i.test(upstream.pathname);
}

function preferMp4ProxyVariant(value: string): string {
  const parsed = parseUrl(value);
  if (!parsed || !parsed.pathname.endsWith('/api/xtream/stream')) return value;
  const rawUpstream = parsed.searchParams.get('url');
  if (!rawUpstream) return value;

  try {
    const upstream = new URL(rawUpstream);
    if (!/\.mkv$/i.test(upstream.pathname)) return value;
    upstream.pathname = upstream.pathname.replace(/\.mkv$/i, '.mp4');
    parsed.searchParams.set('url', upstream.toString());
    return parsed.toString();
  } catch {
    return value;
  }
}

function getSourceStart(value: string): number {
  const parsed = canonicalProxyUrl(value);
  if (!parsed) return 0;
  const start = Number(parsed.searchParams.get('start') || '0');
  return Number.isFinite(start) && start > 0 ? start : 0;
}

function withStart(value: string, seconds: number): string {
  const parsed = canonicalProxyUrl(value);
  if (!parsed) return value;
  const target = Math.max(0, Math.floor(seconds));
  if (target > 0) parsed.searchParams.set('start', String(target));
  else parsed.searchParams.delete('start');
  return parsed.toString();
}

function withPlaybackIdentity(value: string, session: string, playback: string): string {
  const parsed = canonicalProxyUrl(value);
  if (!parsed) return value;
  parsed.searchParams.set('session', session);
  parsed.searchParams.set('playback', playback);
  return parsed.toString();
}

function toHlsPlaybackUrl(value: string): string {
  if (!usesGeneratedHls(value)) return value;
  const parsed = canonicalProxyUrl(value);
  const upstream = getUpstreamUrl(value);
  if (!parsed || !upstream) return value;

  const session = parsed.searchParams.get('session');
  const playback = parsed.searchParams.get('playback');
  if (!session || !playback) return value;

  const hls = new URL(
    `/api/xtream/hls/${encodeURIComponent(session)}/${encodeURIComponent(playback)}/index.m3u8`,
    window.location.origin
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
  const source = canonicalProxyUrl(value);
  const upstream = getUpstreamUrl(value);
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
  const parsed = canonicalProxyUrl(value);
  if (!parsed) return;
  const session = parsed.searchParams.get('session');
  const playback = parsed.searchParams.get('playback');
  if (!session || !playback) return;

  const stopUrl = new URL('/api/xtream/stop', window.location.origin);
  stopUrl.searchParams.set('session', session);
  stopUrl.searchParams.set('playback', playback);
  void fetch(stopUrl.toString(), {
    method: 'POST',
    cache: 'no-store',
    keepalive: true,
  }).catch(() => {});
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
  const seekCursorRef = useRef(Math.max(0, initialTime));
  const pendingSeekRef = useRef<{ target: number; resume: boolean } | null>(null);
  const seekRestartTimerRef = useRef<number | null>(null);
  const originalMkvFallbackRef = useRef<string | null>(null);

  const feedbackTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const controlsGenerationRef = useRef(0);
  const controlsVisibleUntilRef = useRef(0);
  const playerRef = useRef<HTMLDivElement>(null);
  const tapRef = useRef<{ time: number; side: number } | null>(null);
  const singleTapTimerRef = useRef<number | null>(null);
  const mouseClickStartedVisibleRef = useRef(true);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const scrubRef = useRef<number | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);

  const [activeUrl, setActiveUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() => getKnownDuration(item, seriesContext));
  const [buffered, setBuffered] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<string | null>(null);
  const [seekFeedbackSide, setSeekFeedbackSide] = useState<'left' | 'center' | 'right'>('center');
  const [showControls, setShowControls] = useState(true);
  const showControlsRef = useRef(true);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<{ id: number; label: string; language: string }[]>([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(-1);

  const isLive = item.type === 'live';
  const isSeries = item.type === 'series' || !!seriesContext;
  const metadataDuration = getKnownDuration(item, seriesContext);

  const setControlsVisible = useCallback((visible: boolean) => {
    showControlsRef.current = visible;
    setShowControls(visible);
  }, []);

  const cancelControlsHide = useCallback(() => {
    controlsGenerationRef.current += 1;
    controlsVisibleUntilRef.current = 0;
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback((visibleForMs: number = 3000) => {
    cancelControlsHide();

    if (
      !isPlaying ||
      isBuffering ||
      !!playbackError ||
      showEpisodes ||
      scrubRef.current !== null ||
      keyboardFocus
    ) {
      return;
    }

    const generation = controlsGenerationRef.current;
    const deadline = performance.now() + visibleForMs;
    controlsVisibleUntilRef.current = deadline;

    const attemptHide = () => {
      if (generation !== controlsGenerationRef.current) return;

      const remaining = controlsVisibleUntilRef.current - performance.now();
      if (remaining > 24) {
        controlsTimerRef.current = window.setTimeout(attemptHide, Math.ceil(remaining));
        return;
      }

      controlsTimerRef.current = null;
      controlsVisibleUntilRef.current = 0;
      setControlsVisible(false);
    };

    controlsTimerRef.current = window.setTimeout(attemptHide, visibleForMs);
  }, [
    cancelControlsHide,
    isPlaying,
    isBuffering,
    playbackError,
    showEpisodes,
    keyboardFocus,
    setControlsVisible,
  ]);

  const revealControls = useCallback((visibleForMs: number = 3000) => {
    setControlsVisible(true);
    scheduleControlsHide(visibleForMs);
  }, [scheduleControlsHide, setControlsVisible]);

  const hideControls = useCallback(() => {
    cancelControlsHide();
    setControlsVisible(false);
  }, [cancelControlsHide, setControlsVisible]);

  const toggleControls = useCallback(() => {
    const controlsArePinned =
      !isPlaying ||
      isBuffering ||
      !!playbackError ||
      showEpisodes ||
      scrubRef.current !== null ||
      keyboardFocus;

    if (controlsArePinned) {
      cancelControlsHide();
      setControlsVisible(true);
      return;
    }

    if (showControlsRef.current) hideControls();
    else revealControls();
  }, [
    isPlaying,
    isBuffering,
    playbackError,
    showEpisodes,
    keyboardFocus,
    cancelControlsHide,
    setControlsVisible,
    hideControls,
    revealControls,
  ]);

  useEffect(() => {
    if (isBuffering || playbackError || showEpisodes || scrubTime !== null || keyboardFocus || !isPlaying) {
      cancelControlsHide();
      setControlsVisible(true);
      return;
    }

    // Playback became eligible for auto-hide. Start one fresh visibility window.
    revealControls();
  }, [
    isBuffering,
    playbackError,
    showEpisodes,
    scrubTime,
    keyboardFocus,
    isPlaying,
    cancelControlsHide,
    revealControls,
    setControlsVisible,
  ]);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    if (seekRestartTimerRef.current !== null) window.clearTimeout(seekRestartTimerRef.current);
    if (singleTapTimerRef.current !== null) window.clearTimeout(singleTapTimerRef.current);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
  }, []);

  const buildPlaybackUrl = useCallback((baseUrl: string, startSeconds?: number) => {
    let next = withPlaybackIdentity(baseUrl, sessionRef.current, String(++playbackCounterRef.current));
    if (typeof startSeconds === 'number' && startSeconds > 0) next = withStart(next, startSeconds);
    else next = withStart(next, 0);
    return next;
  }, []);

  const safePlay = useCallback(() => {
    resumeAfterSourceChangeRef.current = true;
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
    resumeAfterSourceChangeRef.current = false;
    const video = videoRef.current;
    if (!video) return;
    try { video.pause(); } catch {}
    setIsPlaying(false);
  }, []);

  const updateDurationFromMedia = useCallback(() => {
    if (usesGeneratedHls(activeUrl)) {
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
    const preferredStreamUrl = preferMp4ProxyVariant(streamUrl);
    originalMkvFallbackRef.current = preferredStreamUrl !== streamUrl ? streamUrl : null;
    const generated = usesGeneratedHls(preferredStreamUrl);
    const next = buildPlaybackUrl(preferredStreamUrl, generated && initialTime > 0 ? initialTime : undefined);
    initialNativeSeekRef.current = generated ? 0 : Math.max(0, initialTime);
    resumeAfterSourceChangeRef.current = true;
    setActiveUrl(next);
    seekCursorRef.current = Math.max(0, initialTime);
    pendingSeekRef.current = null;
    if (seekRestartTimerRef.current !== null) {
      window.clearTimeout(seekRestartTimerRef.current);
      seekRestartTimerRef.current = null;
    }
    setCurrentTime(0);
    setBuffered(0);
    setDuration(getKnownDuration(item, seriesContext));
    setPlaybackError(null);
    setIsBuffering(true);
  }, [buildPlaybackUrl, initialTime, item.id, metadataDuration, seriesContext?.episode?.id, streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeUrl) return;

    const mediaUrl = toHlsPlaybackUrl(activeUrl);
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
      if (initialNativeSeekRef.current > 0) {
        const target = initialNativeSeekRef.current;
        const seekableEnd = video.seekable.length
          ? video.seekable.end(video.seekable.length - 1)
          : 0;
        if (target <= seekableEnd + 0.5) {
          initialNativeSeekRef.current = 0;
          try { video.currentTime = target; } catch {}
        }
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

    const hlsMedia = isProviderHls(activeUrl) || usesGeneratedHls(activeUrl);
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
      console.log(`Direct media playback: ${mediaUrl}`);
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
  }, [activeUrl, safePause, safePlay, updateDurationFromMedia]);

  useEffect(() => {
    if (!activeUrl || isLive || !usesGeneratedHls(activeUrl) || duration > 0) return;
    let cancelled = false;
    void lookupXtreamDuration(activeUrl, seriesContext).then((seconds) => {
      if (!cancelled && seconds > 0) setDuration(seconds);
    });
    return () => { cancelled = true; };
  }, [activeUrl, duration, isLive, seriesContext?.seriesId]);

  const logicalCurrentTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return currentTime;
    const raw = Number(video.currentTime);
    if (!Number.isFinite(raw)) return currentTime;
    return usesGeneratedHls(activeUrl) ? getSourceStart(activeUrl) + raw : raw;
  }, [activeUrl, currentTime]);

  const recordProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !activeUrl) return;

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
    if (!usesGeneratedHls(activeUrl)) {
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

  useEffect(() => {
    const flushProgress = () => progressRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushProgress();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushProgress);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushProgress);
    };
  }, []);

  const seekToPosition = useCallback((requestedSeconds: number) => {
    const video = videoRef.current;
    if (!video || isLive || !Number.isFinite(requestedSeconds)) return false;

    const upper = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    const target = Math.max(0, Math.min(upper, requestedSeconds));
    const wasPlaying = pendingSeekRef.current?.resume ?? (isBuffering ? resumeAfterSourceChangeRef.current : !video.paused);
    const generated = usesGeneratedHls(activeUrl);
    const sourceStart = generated ? getSourceStart(activeUrl) : 0;

    seekCursorRef.current = target;

    const seekableStart = video.seekable.length
      ? sourceStart + video.seekable.start(0)
      : sourceStart;
    const seekableEnd = video.seekable.length
      ? sourceStart + video.seekable.end(video.seekable.length - 1)
      : sourceStart;

    if (generated && (target < seekableStart - 0.5 || target > seekableEnd + 0.5)) {
      pendingSeekRef.current = { target, resume: wasPlaying };
      setSeekFeedback(`Jumping to ${formatTime(target)}...`);

      if (seekRestartTimerRef.current !== null) {
        window.clearTimeout(seekRestartTimerRef.current);
      }

      seekRestartTimerRef.current = window.setTimeout(() => {
        seekRestartTimerRef.current = null;
        const pending = pendingSeekRef.current;
        if (!pending) return;

        pendingSeekRef.current = null;
        resumeAfterSourceChangeRef.current = pending.resume;
        const nextUrl = buildPlaybackUrl(activeUrl, pending.target);
        setCurrentTime(pending.target);
        setBuffered(pending.target);
        setIsBuffering(true);
        setPlaybackError(null);
        setActiveUrl(nextUrl);
        console.log(`Instant HLS source switch: target=${Math.floor(pending.target)}s url=${nextUrl}`);
      }, 140);

      return false;
    }

    pendingSeekRef.current = null;
    if (seekRestartTimerRef.current !== null) {
      window.clearTimeout(seekRestartTimerRef.current);
      seekRestartTimerRef.current = null;
    }

    try {
      video.currentTime = generated ? Math.max(0, target - sourceStart) : target;
      setCurrentTime(target);
      if (wasPlaying) safePlay();
      return true;
    } catch {
      return false;
    }
  }, [activeUrl, buildPlaybackUrl, duration, isLive, isBuffering, safePlay]);

  const handleSeek = useCallback((delta: number, side: 'left' | 'center' | 'right' = 'center') => {
    const video = videoRef.current;
    if (!video) return;

    const pending = pendingSeekRef.current?.target;
    const mediaTime = Number(video.currentTime);
    const base = Number.isFinite(pending)
      ? pending!
      : Number.isFinite(seekCursorRef.current)
        ? seekCursorRef.current
        : Number.isFinite(mediaTime)
          ? mediaTime
          : currentTime;

    const target = base + delta;
    seekToPosition(target);
    setSeekFeedbackSide(side);
    setSeekFeedback(`${delta >= 0 ? '+' : ''}${delta}s`);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setSeekFeedback(null), 700);
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
    if (seekRestartTimerRef.current !== null) {
      window.clearTimeout(seekRestartTimerRef.current);
      seekRestartTimerRef.current = null;
    }
    pendingSeekRef.current = null;
    progressRef.current();
    stopPlaybackUrl(activeUrl);
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    hardStopVideo(videoRef.current);
    onClose();
  }, [activeUrl, onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    playerRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const raw = Number(video.currentTime);
    if (!Number.isFinite(raw)) return;

    const sourceStart = usesGeneratedHls(activeUrl) ? getSourceStart(activeUrl) : 0;
    const absolute = sourceStart + raw;
    setCurrentTime(absolute);

    let seekableEnd = sourceStart;
    if (video.seekable.length > 0) {
      seekableEnd = sourceStart + video.seekable.end(video.seekable.length - 1);
      setBuffered(seekableEnd);
    } else if (video.buffered.length > 0) {
      seekableEnd = sourceStart + video.buffered.end(video.buffered.length - 1);
      setBuffered(seekableEnd);
    }

    if (!pendingSeekRef.current) {
      seekCursorRef.current = absolute;
    }

    if (initialNativeSeekRef.current > 0 && video.seekable.length > 0) {
      const target = initialNativeSeekRef.current;
      const nativeSeekableEnd = video.seekable.end(video.seekable.length - 1);
      if (target <= nativeSeekableEnd + 0.5) {
        initialNativeSeekRef.current = 0;
        seekCursorRef.current = target;
        try { video.currentTime = target; } catch {}
      }
    }

    updateDurationFromMedia();
    if (raw > 0.05) setIsBuffering(false);
  }, [activeUrl, updateDurationFromMedia]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      revealControls();
      const target = event.target as HTMLElement;
      if (event.key === 'Tab') {
        const buttons = Array.from(playerRef.current?.querySelectorAll<HTMLElement>('button, select, [role="slider"]') || []).filter((element: HTMLElement) => element.getClientRects().length);
        const first = buttons[0] as HTMLElement | undefined;
        const last = buttons[buttons.length - 1] as HTMLElement | undefined;
        if (!showControls) {
          event.preventDefault();
          requestAnimationFrame(() => (event.shiftKey ? last : first)?.focus());
        } else if (event.shiftKey && (target === first || target === playerRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && target === last) { event.preventDefault(); first?.focus(); }
      }
      const code = event.keyCode || event.which;
      if (event.key === 'Escape' && showEpisodes) {
        event.preventDefault(); setShowEpisodes(false); return;
      }
      if (target.closest('input, select, textarea, [role="slider"], [contenteditable="true"]') && event.key !== 'Escape') return;
      if (target.closest('button') && code === 32) return;
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
  }, [closePlayer, handleSeek, isLive, togglePlay, revealControls, showEpisodes, showControls]);

  const nextEpisode = isSeries && seriesContext?.allEpisodes
    ? seriesContext.allEpisodes.find((episode) => episode.episode_num === seriesContext.episode.episode_num + 1)
    : null;

  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, ((scrubTime ?? currentTime) / duration) * 100)) : 0;
  const bufferPercent = duration > 0 ? Math.max(0, Math.min(100, (buffered / duration) * 100)) : 0;

  return (
    <div
      ref={playerRef}
      id="video-player"
      tabIndex={-1}
      style={{ cursor: showControls ? undefined : 'none' }}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
      onPointerMove={(event) => { if (event.pointerType === 'mouse') revealControls(); }}
      onPointerDown={(event) => {
        setKeyboardFocus(false);
        if (event.pointerType === 'mouse') revealControls();
      }}
      onFocusCapture={(event) => {
        if (event.target !== event.currentTarget && event.target.matches(':focus-visible')) setKeyboardFocus(true);
        revealControls();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
      }}
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
            setSeekFeedback(null);
          }}
          onPause={() => setIsPlaying(false)}
          onError={(event) => {
            const video = event.currentTarget;
            const error = video.error;
            if (error?.code === MediaError.MEDIA_ERR_ABORTED) return;

            const mkvFallback = originalMkvFallbackRef.current;
            if (mkvFallback && !usesGeneratedHls(activeUrl)) {
              originalMkvFallbackRef.current = null;
              const target = Math.max(0, currentTime || initialTime || 0);
              const next = buildPlaybackUrl(mkvFallback, target > 0 ? target : undefined);
              console.warn('Preferred MP4 variant failed; falling back to MKV generated HLS.');
              resumeAfterSourceChangeRef.current = true;
              initialNativeSeekRef.current = 0;
              setPlaybackError(null);
              setIsBuffering(true);
              setActiveUrl(next);
              return;
            }

            const detail = error?.message || `media error ${error?.code || 'unknown'}`;
            console.warn('Video playback error:', detail, 'src=', video.currentSrc || activeUrl);
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

      <div
        className="absolute inset-0 z-10"
        style={{ touchAction: 'manipulation' }}
        aria-label="Playback gesture area"
        onPointerDown={(event) => {
          if (!event.isPrimary) return;
          if (event.pointerType === 'mouse') {
            mouseClickStartedVisibleRef.current = showControls;
            return;
          }
          touchStartRef.current = { x: event.clientX, y: event.clientY, time: Date.now() };
        }}
        onPointerCancel={() => {
          touchStartRef.current = null;
          tapRef.current = null;
          if (singleTapTimerRef.current !== null) {
            window.clearTimeout(singleTapTimerRef.current);
            singleTapTimerRef.current = null;
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerType === 'mouse') {
            if (!event.isPrimary || event.button !== 0) return;
            if (showEpisodes) {
              setShowEpisodes(false);
              revealControls();
            } else if (mouseClickStartedVisibleRef.current && isPlaying && !isBuffering && !playbackError) {
              hideControls();
            } else {
              revealControls();
            }
            return;
          }

          const start = touchStartRef.current;
          touchStartRef.current = null;
          if (
            !start ||
            !event.isPrimary ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 20 ||
            Date.now() - start.time > 350
          ) {
            tapRef.current = null;
            return;
          }

          const now = Date.now();
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          const side = ratio < 0.4 ? -1 : ratio > 0.6 ? 1 : 0;
          const previous = tapRef.current;

          if (!isLive && side && previous?.side === side && now - previous.time < 330) {
            if (singleTapTimerRef.current !== null) {
              window.clearTimeout(singleTapTimerRef.current);
              singleTapTimerRef.current = null;
            }
            tapRef.current = null;
            setShowEpisodes(false);
            revealControls();
            handleSeek(side * 10, side < 0 ? 'left' : 'right');
            return;
          }

          tapRef.current = { time: now, side };
          if (singleTapTimerRef.current !== null) window.clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = window.setTimeout(() => {
            singleTapTimerRef.current = null;
            tapRef.current = null;
            if (showEpisodes) {
              setShowEpisodes(false);
              revealControls();
            } else {
              toggleControls();
            }
          }, side && !isLive ? 335 : 120);
        }}
      />

      {isBuffering && !playbackError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="player-buffering-card glass-surface rounded-xl px-5 py-3 text-sm font-semibold text-slate-100">
            Buffering stream...
          </div>
        </div>
      )}

      {playbackError && (
        <div className="player-error-backdrop absolute inset-0 z-40 flex items-center justify-center p-6">
          <div className="player-error-card glass-modal max-w-lg w-full rounded-2xl border-rose-500/35 p-6 text-center space-y-4">
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
                className="player-primary-control tv-focus px-4 py-2 rounded-lg text-white font-semibold"
              >Retry</button>
              <button aria-label="Close player" onClick={closePlayer} className="player-control glass-control tv-focus px-4 py-2 rounded-lg text-white font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}

      {seekFeedback && (
        <div
          className={`player-seek-feedback absolute inset-y-0 z-30 pointer-events-none flex items-center ${ 
            seekFeedbackSide === 'left'
              ? 'left-[12%] justify-start'
              : seekFeedbackSide === 'right'
              ? 'right-[12%] justify-end'
              : 'inset-x-0 justify-center'
          }`}
        >
          <div className="player-seek-feedback-card glass-control rounded-xl border-sky-500/45 px-6 py-4 text-xl font-bold text-white">
            {seekFeedback}
          </div>
        </div>
      )}

      <div inert={!showControls} className={`player-top absolute top-0 inset-x-0 z-30 p-5 bg-gradient-to-b from-black/55 via-black/20 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="player-osd-surface player-osd-top glass-chrome mx-auto max-w-6xl rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button aria-label="Close player" onClick={closePlayer} className="player-control glass-control tv-focus icon-control rounded-xl text-white">
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
              onClick={() => {
                setShowEpisodes((value) => !value);
                revealControls();
              }}
              className="player-control glass-control tv-focus flex items-center gap-2 px-3 py-2 rounded-xl text-white text-sm"
            >
              <Clapperboard className="w-4 h-4" /> Episodes
            </button>
          )}
        </div>
      </div>

      {showEpisodes && isSeries && seriesContext?.allEpisodes && (
        <div className="player-episodes glass-chrome absolute top-20 right-5 z-40 w-80 max-w-[calc(100%-2.5rem)] max-h-[60dvh] overflow-y-auto rounded-2xl p-3 space-y-2">
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
                aria-current={episode.id === seriesContext.episode.id ? 'true' : undefined}
                className={`player-episode-row glass-control tv-focus w-full min-h-12 text-left rounded-xl border p-3 text-sm text-white transition-all duration-200 ${
                  episode.id === seriesContext.episode.id
                    ? 'border-sky-500/60 bg-sky-500/15 shadow-[0_0_18px_rgba(56,189,248,0.12)]'
                    : 'hover:border-white/20'
                }`}
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

      <div inert={!showControls} className={`player-bottom absolute bottom-0 inset-x-0 z-30 p-5 bg-gradient-to-t from-black/65 via-black/25 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="player-osd-surface player-osd-bottom glass-chrome mx-auto max-w-6xl rounded-2xl p-3 sm:p-4">
        {!isLive && (
          <div className="mb-4">
            <div className="player-seek-zone relative h-11 flex items-center">
              <div className="player-seek-track relative h-3 w-full pointer-events-none">
                <div className="player-seek-rail absolute inset-0 rounded-full bg-slate-800 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-slate-600/60" style={{ width: `${bufferPercent}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500 to-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.65)] transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
                </div>
                <div
                  className="player-seek-thumb absolute w-4 h-4 rounded-full bg-white border-2 border-sky-500 shadow-lg shadow-sky-500/40 pointer-events-none transition-[left] duration-75"
                  style={{ left: `${progressPercent}%` }}
                />
              </div>
              {scrubTime !== null && duration > 0 && (
                <div
                  className="player-scrub-preview glass-control absolute bottom-9 -translate-x-1/2 pointer-events-none rounded-lg border-sky-500/40 px-2.5 py-1.5 text-xs font-mono font-semibold text-white"
                  style={{ left: `${Math.max(2, Math.min(98, (scrubTime / duration) * 100))}%` }}
                >
                  {formatTime(scrubTime)}
                </div>
              )}
              <div
                role="slider"
                tabIndex={duration > 0 ? 0 : -1}
                aria-label="Seek playback"
                aria-valuetext={formatTime(scrubTime ?? currentTime)}
                aria-valuemin={0} aria-valuemax={duration || 1}
                aria-valuenow={scrubTime ?? Math.min(currentTime, duration || 1)}
                aria-disabled={!(duration > 0)}
                className="seek-slider absolute inset-0 w-full h-full cursor-pointer touch-none outline-none"
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0 || !(duration > 0)) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const rect = event.currentTarget.getBoundingClientRect();
                  const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
                  scrubRef.current = target; setScrubTime(target); revealControls();
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
                  scrubRef.current = target; setScrubTime(target); revealControls();
                }}
                onPointerUp={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
                  scrubRef.current = null; setScrubTime(null);
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  seekToPosition(target); revealControls();
                }}
                onPointerCancel={() => { scrubRef.current = null; setScrubTime(null); }}
                onLostPointerCapture={() => { scrubRef.current = null; setScrubTime(null); }}
                onKeyDown={(event) => {
                  if (!(duration > 0)) return;
                  const steps: Record<string, number> = { ArrowLeft: -10, ArrowDown: -10, ArrowRight: 10, ArrowUp: 10, PageDown: -60, PageUp: 60 };
                  if (event.key in steps || event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    seekToPosition(event.key === 'Home' ? 0 : event.key === 'End' ? duration : seekCursorRef.current + steps[event.key]);
                  }
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs font-mono text-slate-300">
              <span>{formatTime(scrubTime ?? currentTime)}</span>
              <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button aria-label={isPlaying ? "Pause" : "Play"} onClick={togglePlay} className="player-primary-control tv-focus w-11 h-11 rounded-xl text-white flex items-center justify-center">
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            {!isLive && (
              <>
                <button onClick={() => handleSeek(-10, 'left')} className="player-control glass-control tv-focus p-2.5 rounded-xl text-white flex items-center gap-1 text-sm">
                  <RotateCcw className="w-4 h-4" /> 10s
                </button>
                <button onClick={() => handleSeek(10, 'right')} className="player-control glass-control tv-focus p-2.5 rounded-xl text-white flex items-center gap-1 text-sm">
                  <RotateCw className="w-4 h-4" /> 10s
                </button>
              </>
            )}

            <button
              aria-label={isMuted ? "Unmute" : "Mute"}
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                video.muted = !video.muted;
                setIsMuted(video.muted);
              }}
              className="player-control glass-control tv-focus p-2.5 rounded-xl text-white"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          {subtitleTracks.length > 0 && (
            <div className="flex items-center gap-2">
              <Subtitles className="w-4 h-4 text-slate-300" />
              <select
                aria-label="Subtitles"
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
                className="player-control glass-control tv-focus rounded-lg px-2 py-1 text-sm text-white"
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
    </div>
  );
};
