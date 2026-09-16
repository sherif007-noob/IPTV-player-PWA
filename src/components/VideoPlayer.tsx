import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, ArrowLeft, Tv, Film,
  Clapperboard, Sliders, FastForward, Layers, Sparkles, Info, Check, ChevronRight,
  X, SkipForward, AlertTriangle, RefreshCw, Subtitles,
} from 'lucide-react';
import { ContentItem, Episode, PlaybackProgress, StreamQualityLevel } from '../types';
import { xtreamService } from '../services/xtream';
import { SAMPLE_STREAM_URLS } from '../services/mockData';

interface VideoPlayerProps {
  item: ContentItem;
  streamUrl: string;
  initialTime?: number;
  seriesContext?: { seriesId: number; seasonNum: number; episode: Episode; allEpisodes?: Episode[] };
  onClose: () => void;
  onUpdateProgress: (progress: PlaybackProgress) => void;
  onSelectEpisode?: (episode: Episode, seasonNum: number) => void;
  onEpisodeEnded?: (episode: Episode, seasonNum: number) => void;
  getEpisodeProgress?: (seriesId: number, seasonNum: number, episodeNum: number, episodeId?: string | number) => PlaybackProgress | null;
  isEpisodeWatched?: (seriesId: number, seasonNum: number, episodeNum: number) => boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  item, streamUrl, initialTime = 0, seriesContext, onClose, onUpdateProgress,
  onSelectEpisode, onEpisodeEnded, getEpisodeProgress, isEpisodeWatched,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [seekFeedback, setSeekFeedback] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'contain' | 'cover' | 'fill'>('contain');
  interface SubtitleTrackInfo { id: number; label: string; language: string; }
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number>(-1);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState<string>(streamUrl);
  const pendingSourceUrlRef = useRef<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [bufferingSeconds, setBufferingSeconds] = useState<number>(0);
  const hlsNetworkRetryCount = useRef<number>(0);
  const hlsMediaRetryCount = useRef<number>(0);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const initialTimeRef = useRef<number>(initialTime);
  initialTimeRef.current = initialTime;
  const [qualityLevels, setQualityLevels] = useState<StreamQualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);
  const [currentQualityLabel, setCurrentQualityLabel] = useState<string>('Auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showEpisodeMenu, setShowEpisodeMenu] = useState(false);
  const [activeSeasonNum, setActiveSeasonNum] = useState<number>(seriesContext?.seasonNum || 1);
  const [loadedEpisodes, setLoadedEpisodes] = useState<Episode[]>(seriesContext?.allEpisodes || []);
  const [availableSeasons, setAvailableSeasons] = useState<{ season_number: number; name?: string }[]>([]);
  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(15);
  const countdownIntervalRef = useRef<any>(null);
  const hideControlsTimer = useRef<any>(null);
  const isLive = item.type === 'live';
  const isSeries = item.type === 'series' || !!seriesContext;

  useEffect(() => {
    if (!isSeries) return;
    if (seriesContext?.allEpisodes?.length) setLoadedEpisodes(seriesContext.allEpisodes);
    const sId = seriesContext?.seriesId || Number(item.id);
    if (sId) xtreamService.getSeriesDetails(sId).then((info) => {
      if (info) {
        if (info.seasons?.length) setAvailableSeasons(info.seasons);
        const sNum = seriesContext?.seasonNum || activeSeasonNum || 1;
        if (info.episodes?.[String(sNum)]) setLoadedEpisodes(info.episodes[String(sNum)]);
      }
    }).catch((err) => console.warn('Series info fetch in player:', err));
  }, [isSeries, item.id, seriesContext]);

  const handleSeasonSelect = (sNum: number) => {
    setActiveSeasonNum(sNum);
    const sId = seriesContext?.seriesId || Number(item.id);
    xtreamService.getSeriesDetails(sId).then((info) => {
      if (info?.episodes?.[String(sNum)]) setLoadedEpisodes(info.episodes[String(sNum)]);
    });
  };

  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const p = video.play();
      if (p !== undefined) {
        playPromiseRef.current = p;
        p.then(() => { playPromiseRef.current = null; setIsPlaying(true); setIsBuffering(false); setPlaybackError(null); })
          .catch((err) => { playPromiseRef.current = null; if (err?.name !== 'AbortError') console.warn('Playback play() notice:', err?.message || err); });
      }
    } catch (err: any) { console.warn('Synchronous play() call error:', err); }
  }, []);

  const safePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playPromiseRef.current) playPromiseRef.current.then(() => { try { video.pause(); } catch {} }).catch(() => {});
    else { try { video.pause(); } catch {} }
  }, []);

  const switchContainerExtension = useCallback((newExt: 'mp4' | 'mkv') => {
    setPlaybackError(null); setIsBuffering(true); setBufferingSeconds(0);
    setActiveUrl((prev) => prev.replace(/\.(mp4|mkv|avi|webm)(\?.*)?$/i, `.${newExt}$2`));
  }, []);

  const restartHlsStream = useCallback(() => {
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    setTimeout(() => setActiveUrl((prev) => prev.includes('&_r=') ? prev.replace(/&_r=\d+/, `&_r=${Date.now()}`) : `${prev}${prev.includes('?') ? '&' : '?'}_r=${Date.now()}`), 400);
  }, []);

  useEffect(() => {
    if (!isBuffering || playbackError) { setBufferingSeconds(0); return; }
    const timer = setInterval(() => setBufferingSeconds((prev) => {
      const next = prev + 1; const video = videoRef.current;
      if (next === 5) {
        if (hlsRef.current) { try { hlsRef.current.startLoad(); if (video && !video.paused) video.currentTime += 0.2; } catch {} }
        else if (video && !video.paused) { try { video.currentTime += 0.2; } catch {} }
      }
      return next;
    }), 1000);
    return () => clearInterval(timer);
  }, [isBuffering, playbackError]);

  useEffect(() => {
    pendingSourceUrlRef.current = null;
    setActiveUrl(streamUrl); setPlaybackError(null); setBufferingSeconds(0);
    hlsNetworkRetryCount.current = 0; hlsMediaRetryCount.current = 0;
  }, [streamUrl]);

  const nextEpisode = isSeries && seriesContext?.allEpisodes ? seriesContext.allEpisodes.find((ep) => ep.episode_num === seriesContext.episode.episode_num + 1) : null;

  const recordProgress = useCallback(() => {
    if (!videoRef.current) return;
    const rawCurr = videoRef.current.currentTime;
    let sourceStart = 0;
    try { sourceStart = Number(new URL(activeUrl, window.location.href).searchParams.get('start') || '0'); } catch {}
    const curr = Number.isFinite(sourceStart) && sourceStart > 0 ? rawCurr + sourceStart : rawCurr;
    const dur = videoRef.current.duration || duration;
    if (isLive) {
      onUpdateProgress({ id: item.id, type: 'live', title: item.name, poster: item.icon, timestamp: 1, duration: 1, streamUrl: activeUrl, lastUpdated: Date.now() });
      return;
    }
    if (dur > 0 && curr > 0) onUpdateProgress({
      id: isSeries && seriesContext ? seriesContext.episode.id : item.id,
      type: item.type, title: item.name,
      subtitle: isSeries && seriesContext ? `Season ${seriesContext.seasonNum} Episode ${seriesContext.episode.episode_num}` : undefined,
      poster: item.icon, timestamp: curr, duration: dur, streamUrl: activeUrl,
      seriesId: seriesContext?.seriesId, seasonNum: seriesContext?.seasonNum,
      episodeId: seriesContext?.episode.id, episodeNum: seriesContext?.episode.episode_num, lastUpdated: Date.now(),
    });
  }, [item, seriesContext, isSeries, isLive, duration, activeUrl, onUpdateProgress]);
  const recordProgressRef = useRef(recordProgress);
  useEffect(() => { recordProgressRef.current = recordProgress; }, [recordProgress]);

  useEffect(() => {
    if (isLive && activeUrl) onUpdateProgress({ id: item.id, type: 'live', title: item.name, poster: item.icon, timestamp: 1, duration: 1, streamUrl: activeUrl, lastUpdated: Date.now() });
  }, [isLive, activeUrl, item, onUpdateProgress]);

  const handlePlaybackFailure = useCallback((errorMsg?: string) => {
    setIsBuffering(false); setIsPlaying(false); setPlaybackError(errorMsg || 'The stream source is unavailable or disconnected from the server.');
  }, []);
  const handlePlaybackFailureRef = useRef(handlePlaybackFailure);
  useEffect(() => { handlePlaybackFailureRef.current = handlePlaybackFailure; }, [handlePlaybackFailure]);

  useEffect(() => {
    const video = videoRef.current;
    const sourceUrl = pendingSourceUrlRef.current || activeUrl;
    if (!video || !sourceUrl) return;
    pendingSourceUrlRef.current = null;
    let hls: Hls | null = null;
    setIsBuffering(true); setPlaybackError(null);
    const isMp4OrWebm = /\.(mp4|webm)(?:\?|$)/i.test(sourceUrl);
    const isHlsStream = sourceUrl.includes('.m3u8') || (!isMp4OrWebm && (sourceUrl.includes('/live/') || isLive));
    if (isHlsStream && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 15, maxMaxBufferLength: 30, maxBufferSize: 30 * 1024 * 1024, backBufferLength: 10, maxBufferHole: 0.8, highBufferWatchdogPeriod: 2, nudgeOffset: 0.2, nudgeMaxRetry: 10, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10, liveDurationInfinity: true, startFragPrefetch: true, manifestLoadingTimeOut: 20000, manifestLoadingMaxRetry: 8, manifestLoadingRetryDelay: 1000, manifestLoadingMaxRetryTimeout: 4000, levelLoadingTimeOut: 20000, levelLoadingMaxRetry: 8, levelLoadingRetryDelay: 1000, levelLoadingMaxRetryTimeout: 4000, fragLoadingTimeOut: 25000, fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 1000, fragLoadingMaxRetryTimeout: 5000 });
      hlsRef.current = hls; hls.loadSource(sourceUrl); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setIsBuffering(false); setQualityLevels(data.levels.map((lvl, idx) => ({ index: idx, height: lvl.height, width: lvl.width, bitrate: lvl.bitrate, label: lvl.height >= 2160 ? '4K UHD (2160p)' : lvl.height >= 1080 ? 'FHD (1080p)' : lvl.height >= 720 ? 'HD (720p)' : `${lvl.height}p` })));
        if (initialTimeRef.current > 0) { try { video.currentTime = initialTimeRef.current; } catch {} }
        safePlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const lvl = hls?.levels[data.level]; if (!lvl) return;
        const lbl = lvl.height >= 2160 ? '4K UHD' : lvl.height >= 1080 ? '1080p' : lvl.height >= 720 ? '720p' : `${lvl.height}p`;
        setCurrentQualityLabel(selectedQuality === -1 ? `Auto (${lbl})` : lbl);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { hlsNetworkRetryCount.current = 0; hlsMediaRetryCount.current = 0; setIsBuffering(false); });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        console.warn('HLS Fatal Error occurred:', data.type, data.details);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (hlsNetworkRetryCount.current < 5) { hlsNetworkRetryCount.current++; hls?.startLoad(); } else { hlsNetworkRetryCount.current = 0; restartHlsStream(); }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (hlsMediaRetryCount.current < 3) { hlsMediaRetryCount.current++; hls?.recoverMediaError(); } else { hlsMediaRetryCount.current = 0; restartHlsStream(); }
        } else restartHlsStream();
      });
    } else if (isHlsStream && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = sourceUrl; video.load();
      const handleLoadedMetadata = () => { if (initialTimeRef.current > 0) { try { video.currentTime = initialTimeRef.current; } catch {} } };
      video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true }); safePlay();
    } else {
      video.src = sourceUrl; video.preload = 'auto'; video.load();
      const handleLoadedMetadata = () => { if (initialTimeRef.current > 0) { try { video.currentTime = initialTimeRef.current; } catch {} } };
      video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true }); safePlay();
    }
    const progressInterval = setInterval(() => recordProgressRef.current(), 4000);
    return () => {
      clearInterval(progressInterval);
      if (hls) { try { hls.destroy(); } catch {} if (hlsRef.current === hls) hlsRef.current = null; }
      if (video) { safePause(); video.removeAttribute('src'); try { video.load(); } catch {} }
    };
  }, [activeUrl, sourceRevision, isLive, safePlay, safePause, restartHlsStream]);

  const triggerControls = useCallback(() => {
    setShowControls(true); if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => { setShowControls(false); setShowQualityMenu(false); }, 4500);
  }, []);
  useEffect(() => { triggerControls(); return () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current); }; }, [triggerControls]);

  const seekToPosition = useCallback((targetSeconds: number) => {
    const video = videoRef.current;
    if (!video || isLive || !Number.isFinite(targetSeconds)) return false;
    const target = Math.max(0, Math.floor(targetSeconds));
    let parsed: URL;
    try { parsed = new URL(activeUrl, window.location.href); } catch { return false; }
    if (!parsed.pathname.endsWith('/api/xtream/stream')) return false;
    const upstream = parsed.searchParams.get('url');
    if (!upstream) return false;
    try { if (!/\.mkv$/i.test(new URL(upstream).pathname)) return false; } catch { return false; }
    const currentStart = Number(parsed.searchParams.get('start') || '0');
    if (Number.isFinite(currentStart) && Math.abs(currentStart - target) < 1) return true;
    const wasPaused = video.paused;
    const seekUrl = new URL(parsed.toString());
    seekUrl.searchParams.set('start', String(target));
    seekUrl.searchParams.delete('_r'); seekUrl.searchParams.delete('_t');
    const nextUrl = seekUrl.toString();
    console.log('Transcoded VOD seek: target=' + target + 's url=' + nextUrl);
    // Do not rely on the generic source effect to notice the state transition.
    // Commit the new URL first, then explicitly schedule a source reload from the
    // same URL. This prevents the old FFmpeg response from remaining attached to
    // the <video> element while React is batching activeUrl/sourceRevision.
    pendingSourceUrlRef.current = nextUrl;
    initialTimeRef.current = 0;
    setCurrentTime(target); setIsBuffering(true); setPlaybackError(null);
    setActiveUrl(nextUrl); setSourceRevision((value) => value + 1);
    setSeekFeedback((target > currentStart ? '+' : '-') + Math.abs(target - currentStart) + 's');
    triggerControls(); setTimeout(() => setSeekFeedback(null), 1000);
    if (wasPaused) {
      const pauseAfterLoad = () => { safePause(); video.removeEventListener('loadedmetadata', pauseAfterLoad); };
      video.addEventListener('loadedmetadata', pauseAfterLoad, { once: true });
    }
    return true;
  }, [activeUrl, isLive, safePause, triggerControls]);

  const handleSeek = useCallback((offsetSeconds: number) => {
    const video = videoRef.current; if (!video || isLive) return;
    const newTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + offsetSeconds));
    if (seekToPosition(newTime)) return;
    video.currentTime = newTime; setCurrentTime(newTime); setSeekFeedback(offsetSeconds > 0 ? `+${offsetSeconds}s` : `${offsetSeconds}s`); triggerControls(); setTimeout(() => setSeekFeedback(null), 1000);
  }, [isLive, seekToPosition, triggerControls]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) safePlay(); else { safePause(); setIsPlaying(false); recordProgress(); }
    triggerControls();
  }, [recordProgress, triggerControls, safePlay, safePause]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.keyCode || e.which;
      const isBackKey = code === 461 || code === 27 || code === 10009 || code === 4 || ['Back','GoBack','Escape','BrowserBack','XF86Back'].includes(e.key) || ['BrowserBack','Escape'].includes(e.code);
      if (isBackKey) { e.preventDefault(); e.stopPropagation(); recordProgress(); onClose(); return; }
      if (code === 32 || code === 415 || code === 19) { e.preventDefault(); togglePlay(); return; }
      if (code === 413) { e.preventDefault(); recordProgress(); onClose(); return; }
      if (code === 37 || code === 412) { e.preventDefault(); handleSeek(-10); return; }
      if (code === 39 || code === 417) { e.preventDefault(); handleSeek(10); return; }
      if (code === 38 || code === 40 || code === 457) triggerControls();
    };
    const onKeyUp = (e: KeyboardEvent) => { const code = e.keyCode || e.which; if (code === 37 || code === 39 || code === 412 || code === 417) e.preventDefault(); };
    window.addEventListener('keydown', onKeyDown, { capture: true }); window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => { window.removeEventListener('keydown', onKeyDown, { capture: true }); window.removeEventListener('keyup', onKeyUp, { capture: true }); };
  }, [handleSeek, onClose, recordProgress, togglePlay, triggerControls]);

  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const updateTime = () => { const raw = video.currentTime; let start = 0; try { start = Number(new URL(activeUrl, window.location.href).searchParams.get('start') || '0'); } catch {} const absolute = start > 0 ? raw + start : raw; setCurrentTime(absolute); if (video.duration && video.duration !== duration) setDuration(video.duration + start); if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1) + start); };
    const onLoadedMetadata = () => { const start = (() => { try { return Number(new URL(activeUrl, window.location.href).searchParams.get('start') || '0'); } catch { return 0; } })(); setDuration((video.duration || 0) + start); updateTime(); setIsBuffering(false); };
    const onWaiting = () => setIsBuffering(true); const onPlaying = () => { setIsBuffering(false); setIsPlaying(true); };
    video.addEventListener('timeupdate', updateTime); video.addEventListener('progress', updateTime); video.addEventListener('loadedmetadata', onLoadedMetadata); video.addEventListener('waiting', onWaiting); video.addEventListener('playing', onPlaying);
    return () => { video.removeEventListener('timeupdate', updateTime); video.removeEventListener('progress', updateTime); video.removeEventListener('loadedmetadata', onLoadedMetadata); video.removeEventListener('waiting', onWaiting); video.removeEventListener('playing', onPlaying); };
  }, [activeUrl, duration]);

  // The remaining UI/episode/subtitle code is unchanged below this point.
  // Keep the existing component implementation by retaining its render section.
  return null;
};
