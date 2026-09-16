import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  ArrowLeft,
  Tv,
  Film,
  Clapperboard,
  Sliders,
  FastForward,
  Layers,
  Sparkles,
  Info,
  Check,
  ChevronRight,
  X,
  SkipForward,
  AlertTriangle,
  RefreshCw,
  Subtitles,
} from 'lucide-react';
import {
  ContentItem,
  Episode,
  PlaybackProgress,
  StreamQualityLevel,
} from '../types';
import { xtreamService } from '../services/xtream';
import { SAMPLE_STREAM_URLS } from '../services/mockData';

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

  // Subtitle Tracks state
  interface SubtitleTrackInfo {
    id: number;
    label: string;
    language: string;
  }
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number>(-1); // -1 = Off
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);

  // Playback & buffering state
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [activeUrl, setActiveUrl] = useState<string>(streamUrl);
  const [bufferingSeconds, setBufferingSeconds] = useState<number>(0);
  const hlsNetworkRetryCount = useRef<number>(0);
  const hlsMediaRetryCount = useRef<number>(0);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const initialTimeRef = useRef<number>(initialTime);
  initialTimeRef.current = initialTime;

  // Quality / ABR selector state
  const [qualityLevels, setQualityLevels] = useState<StreamQualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1); // -1 = Auto
  const [currentQualityLabel, setCurrentQualityLabel] = useState<string>('Auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // In-player Episodes Drawer state & loaded episodes
  const [showEpisodeMenu, setShowEpisodeMenu] = useState(false);
  const [activeSeasonNum, setActiveSeasonNum] = useState<number>(seriesContext?.seasonNum || 1);
  const [loadedEpisodes, setLoadedEpisodes] = useState<Episode[]>(seriesContext?.allEpisodes || []);
  const [availableSeasons, setAvailableSeasons] = useState<{ season_number: number; name?: string }[]>([]);

  // Auto next episode countdown
  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(15);
  const countdownIntervalRef = useRef<any>(null);

  // Auto-hide controls timer
  const hideControlsTimer = useRef<any>(null);

  const isLive = item.type === 'live';
  const isSeries = item.type === 'series' || !!seriesContext;

  // Dynamically load series seasons & episodes for in-player drawer switching
  useEffect(() => {
    if (!isSeries) return;

    if (seriesContext?.allEpisodes && seriesContext.allEpisodes.length > 0) {
      setLoadedEpisodes(seriesContext.allEpisodes);
    }

    const sId = seriesContext?.seriesId || Number(item.id);
    if (sId) {
      xtreamService
        .getSeriesDetails(sId)
        .then((info) => {
          if (info) {
            if (info.seasons && info.seasons.length > 0) {
              setAvailableSeasons(info.seasons);
            }
            const sNum = seriesContext?.seasonNum || activeSeasonNum || 1;
            if (info.episodes && info.episodes[String(sNum)]) {
              setLoadedEpisodes(info.episodes[String(sNum)]);
            }
          }
        })
        .catch((err) => {
          console.warn('Series info fetch in player:', err);
        });
    }
  }, [isSeries, item.id, seriesContext]);

  const handleSeasonSelect = (sNum: number) => {
    setActiveSeasonNum(sNum);
    const sId = seriesContext?.seriesId || Number(item.id);
    xtreamService.getSeriesDetails(sId).then((info) => {
      if (info?.episodes?.[String(sNum)]) {
        setLoadedEpisodes(info.episodes[String(sNum)]);
      }
    });
  };

  // Safe playback helpers to avoid "play() interrupted by pause()" errors
  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const p = video.play();
      if (p !== undefined) {
        playPromiseRef.current = p;
        p.then(() => {
          playPromiseRef.current = null;
          setIsPlaying(true);
          setIsBuffering(false);
          setPlaybackError(null);
        }).catch((err) => {
          playPromiseRef.current = null;
          if (err?.name === 'AbortError') return;
          console.warn('Playback play() notice:', err?.message || err);
        });
      }
    } catch (err: any) {
      console.warn('Synchronous play() call error:', err);
    }
  }, []);

  const safePause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playPromiseRef.current) {
      playPromiseRef.current
        .then(() => {
          try {
            video.pause();
          } catch {}
        })
        .catch(() => {});
    } else {
      try {
        video.pause();
      } catch {}
    }
  }, []);

  // Container extension switcher (MP4 <-> MKV) for VOD and series
  const switchContainerExtension = useCallback((newExt: 'mp4' | 'mkv') => {
    setPlaybackError(null);
    setIsBuffering(true);
    setBufferingSeconds(0);
    setActiveUrl((prev) => {
      return prev.replace(/\.(mp4|mkv|avi|webm)(\?.*)?$/i, `.${newExt}$2`);
    });
  }, []);

  // Soft stream restarter on fatal error
  const restartHlsStream = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
    setTimeout(() => {
      setActiveUrl((prev) =>
        prev.includes('&_r=')
          ? prev.replace(/&_r=\d+/, `&_r=${Date.now()}`)
          : `${prev}${prev.includes('?') ? '&' : '?'}_r=${Date.now()}`
      );
    }, 400);
  }, []);

  // Watchdog timer: monitor prolonged stalls on TV and auto-recover buffer holes
  useEffect(() => {
    if (!isBuffering || playbackError) {
      setBufferingSeconds(0);
      return;
    }

    const timer = setInterval(() => {
      setBufferingSeconds((prev) => {
        const next = prev + 1;
        const video = videoRef.current;

        // At 5 seconds of stall: attempt gentle nudging past buffer holes (unstable IPTV packets)
        if (next === 5) {
          if (hlsRef.current) {
            console.log('Stream stalled for 5s: triggering HLS startLoad() and skipping buffer hole...');
            try {
              hlsRef.current.startLoad();
              if (video && !video.paused) {
                video.currentTime += 0.2; // Skip past micro timestamp gap
              }
            } catch {}
          } else if (video && !video.paused) {
            try {
              video.currentTime += 0.2;
            } catch {}
          }
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isBuffering, playbackError]);

  // Sync activeUrl when streamUrl prop changes
  useEffect(() => {
    setActiveUrl(streamUrl);
    setPlaybackError(null);
    setBufferingSeconds(0);
    hlsNetworkRetryCount.current = 0;
    hlsMediaRetryCount.current = 0;
  }, [streamUrl]);

  // Next episode calculation
  const nextEpisode = isSeries && seriesContext?.allEpisodes
    ? seriesContext.allEpisodes.find(
        (ep) => ep.episode_num === seriesContext.episode.episode_num + 1
      )
    : null;

  // Save progress helper (stored in ref to prevent re-attaching video player)
  const recordProgress = useCallback(() => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    const dur = videoRef.current.duration || duration;

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

    if (dur > 0 && curr > 0) {
      onUpdateProgress({
        id: isSeries && seriesContext ? seriesContext.episode.id : item.id,
        type: item.type,
        title: isSeries && seriesContext ? `${item.name}` : item.name,
        subtitle: isSeries && seriesContext
          ? `Season ${seriesContext.seasonNum} Episode ${seriesContext.episode.episode_num}`
          : undefined,
        poster: item.icon,
        timestamp: curr,
        duration: dur,
        streamUrl: activeUrl,
        seriesId: seriesContext?.seriesId,
        seasonNum: seriesContext?.seasonNum,
        episodeId: seriesContext?.episode.id,
        episodeNum: seriesContext?.episode.episode_num,
        lastUpdated: Date.now(),
      });
    }
  }, [item, seriesContext, isSeries, isLive, duration, activeUrl, onUpdateProgress]);

  const recordProgressRef = useRef(recordProgress);
  useEffect(() => {
    recordProgressRef.current = recordProgress;
  }, [recordProgress]);

  // Immediately record live stream to Watch Again history on mount
  useEffect(() => {
    if (isLive && activeUrl) {
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
    }
  }, [isLive, activeUrl, item, onUpdateProgress]);

  // Handle Playback Failure
  const handlePlaybackFailure = useCallback(
    (errorMsg?: string) => {
      setIsBuffering(false);
      setIsPlaying(false);
      setPlaybackError(
        errorMsg ||
          'The stream source is unavailable or disconnected from the server.'
      );
    },
    []
  );

  const handlePlaybackFailureRef = useRef(handlePlaybackFailure);
  useEffect(() => {
    handlePlaybackFailureRef.current = handlePlaybackFailure;
  }, [handlePlaybackFailure]);

  // Video stream initialization with HLS adaptive bitrate and hardware buffer optimization
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeUrl) return;

    let hls: Hls | null = null;
    setIsBuffering(true);
    setPlaybackError(null);

    const isMp4OrWebm = activeUrl.endsWith('.mp4') || activeUrl.endsWith('.webm');
    const isHlsStream =
      activeUrl.includes('.m3u8') ||
      (!isMp4OrWebm && (activeUrl.includes('/live/') || isLive));

    if (isHlsStream && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,

        // Low memory webOS TV buffer limits (prevents out-of-memory crashes on TV)
        maxBufferLength: 15,          // 15 seconds ahead
        maxMaxBufferLength: 30,       // 30 seconds max
        maxBufferSize: 30 * 1024 * 1024, // 30 MB max buffer size
        backBufferLength: 10,         // Release back buffer rapidly

        // Buffer hole & stall auto-recovery for unstable IPTV streams
        maxBufferHole: 0.8,           // Auto-jump micro holes up to 0.8s without freezing
        highBufferWatchdogPeriod: 2,  // Frequent stall checks
        nudgeOffset: 0.2,             // Jump playhead 200ms forward past missing timestamp hole
        nudgeMaxRetry: 10,            // Retry nudging up to 10 times across gap discontinuities

        // Live stream sync & jitter tolerance
        liveSyncDurationCount: 3,     // Stay 3 chunks behind live edge for packet jitter tolerance
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        startFragPrefetch: true,

        // Resilient network timeouts and retries for dropped packets
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 4000,

        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 8,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetryTimeout: 4000,

        fragLoadingTimeOut: 25000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 5000,
      });

      hlsRef.current = hls;
      hls.loadSource(activeUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setIsBuffering(false);
        const levels: StreamQualityLevel[] = data.levels.map((lvl, idx) => ({
          index: idx,
          height: lvl.height,
          width: lvl.width,
          bitrate: lvl.bitrate,
          label:
            lvl.height >= 2160
              ? '4K UHD (2160p)'
              : lvl.height >= 1080
              ? 'FHD (1080p)'
              : lvl.height >= 720
              ? 'HD (720p)'
              : `${lvl.height}p`,
        }));
        setQualityLevels(levels);

        if (initialTimeRef.current > 0) {
          try {
            video.currentTime = initialTimeRef.current;
          } catch {}
        }
        safePlay();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const lvl = hls?.levels[data.level];
        if (lvl) {
          const lbl =
            lvl.height >= 2160
              ? '4K UHD'
              : lvl.height >= 1080
              ? '1080p'
              : lvl.height >= 720
              ? '720p'
              : `${lvl.height}p`;
          setCurrentQualityLabel(selectedQuality === -1 ? `Auto (${lbl})` : lbl);
        }
      });

      // Reset retry counts on successful fragment buffer
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        hlsNetworkRetryCount.current = 0;
        hlsMediaRetryCount.current = 0;
        setIsBuffering(false);
      });

      // Native HLS error handling & auto-recovery
      hls.on(Hls.Events.ERROR, (_, data) => {
        // Non-fatal errors are managed automatically by hls.js (buffer holes, frag retry, stall fix)
        if (!data.fatal) {
          return;
        }

        console.warn('HLS Fatal Error occurred:', data.type, data.details);

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (hlsNetworkRetryCount.current < 5) {
              hlsNetworkRetryCount.current++;
              console.log(
                `HLS Network Error: Attempting startLoad() recovery (${hlsNetworkRetryCount.current}/5)...`
              );
              hls?.startLoad();
            } else {
              console.warn('HLS Network Error retries exceeded, restarting stream...');
              hlsNetworkRetryCount.current = 0;
              restartHlsStream();
            }
            break;

          case Hls.ErrorTypes.MEDIA_ERROR:
            if (hlsMediaRetryCount.current < 3) {
              hlsMediaRetryCount.current++;
              console.log(
                `HLS Media Error: Attempting recoverMediaError() (${hlsMediaRetryCount.current}/3)...`
              );
              hls?.recoverMediaError();
            } else {
              console.warn('HLS Media Error retries exceeded, restarting stream...');
              hlsMediaRetryCount.current = 0;
              restartHlsStream();
            }
            break;

          default:
            console.error('HLS Unrecoverable Fatal Error, restarting stream:', data.details);
            restartHlsStream();
            break;
        }
      });
    } else if (isHlsStream && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari / WebKit HLS playback
      video.src = activeUrl;
      video.load();
      const handleLoadedMetadata = () => {
        if (initialTimeRef.current > 0) {
          try {
            video.currentTime = initialTimeRef.current;
          } catch {}
        }
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      safePlay();
    } else {
      // Direct MP4 / MKV / WebM standard video playback for VOD & Series
      video.src = activeUrl;
      video.preload = 'auto';
      video.load();

      const handleLoadedMetadata = () => {
        if (initialTimeRef.current > 0) {
          try {
            video.currentTime = initialTimeRef.current;
          } catch {}
        }
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      safePlay();
    }

    // Auto-save progress interval
    const progressInterval = setInterval(() => {
      recordProgressRef.current();
    }, 4000);

    return () => {
      clearInterval(progressInterval);
      if (hls) {
        try {
          hls.destroy();
        } catch {}
        hlsRef.current = null;
      }
      if (video) {
        safePause();
        video.removeAttribute('src');
        try {
          video.load();
        } catch {}
      }
    };
  }, [activeUrl, isLive, safePlay, safePause, restartHlsStream]);

  // Handle Controls auto-hide (Magic Remote / pointer inactivity)
  const triggerControls = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) {
      clearTimeout(hideControlsTimer.current);
    }
    hideControlsTimer.current = setTimeout(() => {
      setShowControls(false);
      setShowQualityMenu(false);
    }, 4500);
  }, []);

  useEffect(() => {
    triggerControls();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [triggerControls]);

  // 10-Second Seek Handler (Arrow keys / Remote buttons)
  const handleSeek = useCallback(
    (offsetSeconds: number) => {
      if (!videoRef.current || isLive) return;
      const newTime = Math.max(
        0,
        Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + offsetSeconds)
      );
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setSeekFeedback(offsetSeconds > 0 ? `+${offsetSeconds}s` : `${offsetSeconds}s`);
      triggerControls();

      setTimeout(() => setSeekFeedback(null), 1000);
    },
    [isLive, triggerControls]
  );

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      safePlay();
    } else {
      safePause();
      setIsPlaying(false);
      recordProgress();
    }
    triggerControls();
  }, [recordProgress, triggerControls, safePlay, safePause]);

  // Keyboard & Magic Remote Listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.keyCode || e.which;

      // Back key (461 on webOS / 27 on web / 10009 on Tizen)
      const isBackKey =
        code === 461 ||
        code === 27 ||
        code === 10009 ||
        code === 4 ||
        e.key === 'Back' ||
        e.key === 'GoBack' ||
        e.key === 'Escape' ||
        e.key === 'BrowserBack' ||
        e.key === 'XF86Back' ||
        e.code === 'BrowserBack' ||
        e.code === 'Escape';

      if (isBackKey) {
        e.preventDefault();
        e.stopPropagation();
        recordProgress();
        onClose();
        return;
      }

      // Space / Play / Pause (415: Play, 19: Pause)
      if (code === 32 || code === 415 || code === 19) {
        e.preventDefault();
        togglePlay();
        return;
      }

      // Stop key (413)
      if (code === 413) {
        e.preventDefault();
        recordProgress();
        onClose();
        return;
      }

      // Left Arrow (37) / Rewind (412) -> Seek 10s backward
      if (code === 37 || code === 412) {
        e.preventDefault();
        handleSeek(-10);
        return;
      }

      // Right Arrow (39) / Fast Forward (417) -> Seek 10s forward
      if (code === 39 || code === 417) {
        e.preventDefault();
        handleSeek(10);
        return;
      }

      // Up / Down / Info (457) -> Show controls
      if (code === 38 || code === 40 || code === 457) {
        triggerControls();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.keyCode || e.which;
      if (
        code === 461 ||
        code === 27 ||
        code === 10009 ||
        code === 4 ||
        e.key === 'Back' ||
        e.key === 'GoBack' ||
        e.key === 'Escape' ||
        e.key === 'BrowserBack' ||
        e.key === 'XF86Back' ||
        e.code === 'BrowserBack' ||
        e.code === 'Escape'
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, [onClose, togglePlay, handleSeek, recordProgress, triggerControls]);

  // Video Time Update & Buffer Tracking
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    const dur = videoRef.current.duration || 0;
    setCurrentTime(curr);
    setDuration(dur);

    // Buffer calculation
    if (videoRef.current.buffered.length > 0) {
      const end = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      setBuffered(end);
    }

    // Check if within last 60 seconds of series episode -> Show "Skip to Next Episode" prompt
    if (
      isSeries &&
      nextEpisode &&
      dur > 60 &&
      curr >= dur - 60 &&
      !showNextPrompt
    ) {
      setShowNextPrompt(true);
      setNextCountdown(Math.max(5, Math.floor(dur - curr)));
    }
  };

  // Next episode countdown timer
  useEffect(() => {
    if (showNextPrompt && nextCountdown > 0) {
      countdownIntervalRef.current = setInterval(() => {
        setNextCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownIntervalRef.current);
            if (nextEpisode && onSelectEpisode && seriesContext) {
              onSelectEpisode(nextEpisode, seriesContext.seasonNum);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      };
    }
  }, [showNextPrompt, nextEpisode, onSelectEpisode, seriesContext]);

  // Handle Quality Selection
  const handleSelectQuality = (lvlIndex: number) => {
    setSelectedQuality(lvlIndex);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = lvlIndex;
      if (lvlIndex === -1) {
        setCurrentQualityLabel('Auto (ABR)');
      } else {
        const lvl = qualityLevels[lvlIndex];
        setCurrentQualityLabel(lvl?.label || 'Manual');
      }
    }
    setShowQualityMenu(false);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      id="video-player-container"
      onMouseMove={triggerControls}
      onClick={triggerControls}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
    >
      {/* HTML5 Video element with webOS hardware decoding optimization attributes */}
      <video
        ref={videoRef}
        id="webos-hardware-video"
        className={`w-full h-full ${
          aspectRatio === 'cover'
            ? 'object-cover'
            : aspectRatio === 'fill'
            ? 'object-fill'
            : 'object-contain'
        }`}
        onTimeUpdate={(e) => {
          handleTimeUpdate();
          if (isBuffering && e.currentTarget.currentTime > 0) {
            setIsBuffering(false);
          }
        }}
        onPlay={() => {
          setIsPlaying(true);
          setIsBuffering(false);
          setPlaybackError(null);
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onCanPlayThrough={() => setIsBuffering(false)}
        onLoadedData={() => setIsBuffering(false)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
          setPlaybackError(null);
        }}
        onError={() => {
          // If Hls.js is active, let Hls handle network/media errors and recovery
          if (hlsRef.current) {
            return;
          }
          const mediaErr = videoRef.current?.error;
          if (mediaErr && mediaErr.code === MediaError.MEDIA_ERR_ABORTED) {
            return;
          }
          let msg = 'The media stream could not be loaded.';
          if (mediaErr) {
            switch (mediaErr.code) {
              case MediaError.MEDIA_ERR_NETWORK:
                msg = 'A network error caused the video download to fail.';
                break;
              case MediaError.MEDIA_ERR_DECODE:
                msg = 'The video stream encountered a decoding error. Try switching format.';
                break;
              case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                // Auto-fallback from MKV to MP4 since many browsers drop MKV support
                if (activeUrl.includes('.mkv')) {
                  console.warn('MKV playback failed, auto-switching to MP4 container fallback...');
                  switchContainerExtension('mp4');
                  return;
                }
                if (item.type === 'vod' || item.type === 'series') {
                  msg = 'The stream container or codec is not supported by your browser (often MKV or HEVC/AC3 codecs). Try opening this stream in an external player like VLC.';
                } else {
                  msg = 'The stream source container or codec is not supported by the player.';
                }
                break;
            }
          }
          handlePlaybackFailure(msg);
        }}
        onEnded={() => {
          recordProgress();
          if (isSeries && nextEpisode && onSelectEpisode && seriesContext) {
            onSelectEpisode(nextEpisode, seriesContext.seasonNum);
          }
        }}
        playsInline
        // @ts-ignore
        webos-media-playback="true"
        x-webkit-wireless-video-playback-disabled="true"
      />

      {/* Buffering Indicator with non-intrusive stream reload if prolonged stall */}
      {isBuffering && !playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto z-30">
          <div className="px-6 py-4 rounded-xl bg-black/95 flex flex-col items-center gap-3 border border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-semibold text-slate-200 tracking-wide">
                Buffering stream... {bufferingSeconds > 2 && `(${bufferingSeconds}s)`}
              </span>
            </div>

            {bufferingSeconds >= 8 && (
              <div className="flex flex-col items-center gap-2 pt-2 border-t border-slate-700 w-full">
                <span className="text-xs text-amber-300">
                  Taking longer than expected ({bufferingSeconds}s)
                </span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    id="btn-retry-buffering"
                    onClick={() => {
                      setBufferingSeconds(0);
                      if (hlsRef.current) {
                        hlsRef.current.startLoad();
                      } else {
                        const video = videoRef.current;
                        if (video) {
                          video.load();
                          safePlay();
                        }
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold tv-focus"
                  >
                    Reload Stream
                  </button>
                  {(item.type === 'vod' || item.type === 'series') && (
                    activeUrl.includes('.mkv') ? (
                      <button
                        id="btn-switch-mp4-buffering"
                        onClick={() => switchContainerExtension('mp4')}
                        className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold tv-focus"
                      >
                        Try MP4
                      </button>
                    ) : (
                      <button
                        id="btn-switch-mkv-buffering"
                        onClick={() => switchContainerExtension('mkv')}
                        className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold tv-focus"
                      >
                        Try MKV
                      </button>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Center Play Button Overlay if paused upon start (browser autoplay block) */}
      {!isPlaying && !isBuffering && !playbackError && currentTime === 0 && (
        <div
          id="overlay-center-play"
          onClick={togglePlay}
          className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer z-20 bg-black/40"
        >
          <div className="w-20 h-20 rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center tv-focus mb-3">
            <Play className="w-10 h-10 fill-current ml-1" />
          </div>
          <span className="text-sm font-semibold text-slate-200 bg-black/80 px-4 py-1.5 rounded-full border border-slate-700">
            Press OK or Click to Play
          </span>
        </div>
      )}

      {/* Playback Error Overlay Modal */}
      {playbackError && (
        <div
          id="player-playback-error-overlay"
          className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center p-6 select-none"
        >
          <div className="max-w-md w-full bg-slate-900 border border-rose-500/40 rounded-2xl p-6 sm:p-8 flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                Playback Error
              </h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                {playbackError}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 w-full pt-2">
              <button
                id="btn-player-retry"
                onClick={() => {
                  setPlaybackError(null);
                  setIsBuffering(true);
                  hlsNetworkRetryCount.current = 0;
                  hlsMediaRetryCount.current = 0;
                  setActiveUrl((prev) =>
                    prev.includes('&_t=')
                      ? prev.replace(/&_t=\d+/, `&_t=${Date.now()}`)
                      : `${prev}${prev.includes('?') ? '&' : '?'}_t=${Date.now()}`
                  );
                }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs tv-focus transition-all shadow-lg shadow-sky-500/25"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Stream</span>
              </button>
            </div>

            {/* Open in VLC Button */}
            {(item.type === 'vod' || item.type === 'series') && (
              <a
                href={"vlc://" + xtreamService.getDirectStreamTarget(item.type, item.type === 'series' && seriesContext ? seriesContext.episode.id : item.id, activeUrl.includes('.mp4') ? 'mp4' : 'mkv')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs tv-focus transition-all shadow-lg shadow-orange-500/25 mt-2"
              >
                <span>Open in VLC Player</span>
              </a>
            )}

            {/* Container extension switcher (MKV <-> MP4) */}
            {(item.type === 'vod' || item.type === 'series') && (
              <div className="flex gap-2 w-full">
                {activeUrl.includes('.mkv') ? (
                  <button
                    id="btn-player-switch-mp4"
                    onClick={() => switchContainerExtension('mp4')}
                    className="flex-1 py-2 rounded-xl bg-slate-800/90 border border-slate-700 hover:bg-slate-700 text-slate-300 text-xs font-semibold tv-focus transition-all"
                  >
                    Try MP4 Format
                  </button>
                ) : (
                  <button
                    id="btn-player-switch-mkv"
                    onClick={() => switchContainerExtension('mkv')}
                    className="flex-1 py-2 rounded-xl bg-slate-800/90 border border-slate-700 hover:bg-slate-700 text-slate-300 text-xs font-semibold tv-focus transition-all"
                  >
                    Try MKV Format
                  </button>
                )}
              </div>
            )}

            {/* Load verified demo stream */}
            <button
              id="btn-player-load-demo"
              onClick={() => {
                setPlaybackError(null);
                setIsBuffering(true);
                setActiveUrl(SAMPLE_STREAM_URLS[101]);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold tv-focus transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load Verified Demo Stream</span>
            </button>

            <button
              id="btn-player-close-error"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-white pt-1 transition-colors"
            >
              Close & Return to Library
            </button>
          </div>
        </div>
      )}

      {/* 10-Second Seek Feedback Overlay */}
      {seekFeedback && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-black/90 border border-sky-500/50 text-white">
            {seekFeedback.startsWith('+') ? (
              <RotateCw className="w-10 h-10 text-sky-400" />
            ) : (
              <RotateCcw className="w-10 h-10 text-sky-400" />
            )}
            <span className="text-xl font-bold font-mono tracking-wider">{seekFeedback}</span>
            <span className="text-xs text-slate-300">10s Jump</span>
          </div>
        </div>
      )}

      {/* Next Episode Prompt Card (Appears before episode ends) */}
      {showNextPrompt && nextEpisode && (
        <div
          id="skip-next-episode-card"
          className="absolute bottom-24 right-6 z-40 p-4 rounded-xl bg-slate-900 border border-sky-500/80 max-w-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Next Episode in {nextCountdown}s
            </span>
            <button
              onClick={() => setShowNextPrompt(false)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <h4 className="text-sm font-bold text-white line-clamp-1 mb-3">
            Episode {nextEpisode.episode_num}
          </h4>

          <div className="flex items-center gap-2">
            <button
              id="btn-skip-to-next-episode"
              onClick={() => {
                if (seriesContext && onSelectEpisode) {
                  onSelectEpisode(nextEpisode, seriesContext.seasonNum);
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xs tv-focus"
            >
              <SkipForward className="w-4 h-4 fill-current" />
              <span>Skip to Next Episode</span>
            </button>
          </div>
        </div>
      )}

      {/* Episode List Sliding Drawer (Inside Player) */}
      {showEpisodeMenu && isSeries && (
        <div
          id="in-player-episode-drawer"
          className="absolute inset-y-0 right-0 w-80 sm:w-96 bg-slate-950 border-l border-slate-800 z-40 p-5 flex flex-col shadow-2xl"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <Clapperboard className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold text-white">
                Season {activeSeasonNum} Episodes
              </h3>
            </div>
            <button
              id="btn-close-episode-drawer"
              onClick={() => setShowEpisodeMenu(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 tv-focus"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Season Switcher Tabs (if multiple seasons exist) */}
          {availableSeasons.length > 1 && (
            <div className="flex items-center gap-1.5 py-2.5 overflow-x-auto border-b border-slate-800 shrink-0">
              {availableSeasons.map((s) => (
                <button
                  key={s.season_number}
                  id={`btn-drawer-season-${s.season_number}`}
                  onClick={() => handleSeasonSelect(s.season_number)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 tv-focus ${
                    activeSeasonNum === s.season_number
                      ? 'bg-sky-500 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {s.name || `S${s.season_number}`}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-3 space-y-2">
            {loadedEpisodes.map((ep) => {
              const isCurrent = seriesContext?.episode?.id === ep.id;
              const seriesId = seriesContext?.seriesId || Number(item.id);
              const watched = isEpisodeWatched
                ? isEpisodeWatched(seriesId, activeSeasonNum, ep.episode_num)
                : false;
              const epProgress = getEpisodeProgress
                ? getEpisodeProgress(seriesId, activeSeasonNum, ep.episode_num, ep.id)
                : null;
              const epPercent = watched
                ? 100
                : epProgress && epProgress.duration > 0
                ? Math.min(100, Math.round((epProgress.timestamp / epProgress.duration) * 100))
                : 0;

              return (
                <button
                  key={ep.id}
                  id={`drawer-ep-${ep.id}`}
                  onClick={() => {
                    if (onSelectEpisode) {
                      onSelectEpisode(ep, activeSeasonNum);
                    }
                    setShowEpisodeMenu(false);
                  }}
                  className={`relative w-full text-left p-3 rounded-xl border tv-focus transition-all overflow-hidden ${
                    isCurrent
                      ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                      : watched
                      ? 'bg-slate-900/70 border-slate-800 text-slate-300 hover:bg-slate-850'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold font-mono text-sky-400">
                      Episode {ep.episode_num}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isCurrent && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-sky-500 text-white">
                          Playing
                        </span>
                      )}
                      {watched && !isCurrent && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                          Watched
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-white truncate">
                    Episode {ep.episode_num}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {ep.info?.duration && (
                      <div className="text-[11px] text-slate-400">
                        {ep.info.duration}
                      </div>
                    )}
                    {epPercent > 0 && !watched && (
                      <span className="text-[10px] font-mono text-sky-400">
                        {epPercent}%
                      </span>
                    )}
                  </div>

                  {/* Bottom Full-Width Progress Bar */}
                  {epPercent > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800/80 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          watched ? 'bg-emerald-500' : 'bg-sky-400'
                        }`}
                        style={{ width: `${epPercent}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })}

            {loadedEpisodes.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">
                Loading episodes list...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subtitles Track Selection Menu Popover */}
      {showSubtitleMenu && (
        <div
          id="subtitles-menu-popover"
          className="absolute bottom-20 right-20 z-40 w-56 bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2 py-1 border-b border-slate-800 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Subtitles className="w-3.5 h-3.5 text-sky-400" />
              Subtitles / Captions
            </span>
            <button
              onClick={() => setShowSubtitleMenu(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={() => {
              setSelectedSubtitleTrack(-1);
              if (hlsRef.current) {
                hlsRef.current.subtitleTrack = -1;
              }
              if (videoRef.current?.textTracks) {
                for (let i = 0; i < videoRef.current.textTracks.length; i++) {
                  videoRef.current.textTracks[i].mode = 'disabled';
                }
              }
              setShowSubtitleMenu(false);
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
              selectedSubtitleTrack === -1
                ? 'bg-sky-500 text-white font-bold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span>Off (Disabled)</span>
            {selectedSubtitleTrack === -1 && <Check className="w-3.5 h-3.5" />}
          </button>
          {subtitleTracks.map((trk) => (
            <button
              key={trk.id}
              onClick={() => {
                setSelectedSubtitleTrack(trk.id);
                if (hlsRef.current) {
                  hlsRef.current.subtitleTrack = trk.id;
                }
                if (videoRef.current?.textTracks) {
                  for (let i = 0; i < videoRef.current.textTracks.length; i++) {
                    videoRef.current.textTracks[i].mode =
                      i === trk.id ? 'showing' : 'disabled';
                  }
                }
                setShowSubtitleMenu(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                selectedSubtitleTrack === trk.id
                  ? 'bg-sky-500 text-white font-bold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>{trk.label || trk.language || `Track ${trk.id + 1}`}</span>
              {selectedSubtitleTrack === trk.id && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
          {subtitleTracks.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400 italic">
              No additional subtitle tracks detected for this stream.
            </div>
          )}
        </div>
      )}

      {/* Quality Selection Menu Popover */}
      {showQualityMenu && (
        <div
          id="quality-menu-popover"
          className="absolute bottom-20 right-24 z-40 w-56 bg-slate-900 border border-slate-700 rounded-xl p-2"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2 py-1 border-b border-slate-800">
            HLS Stream Quality
          </div>
          <button
            onClick={() => handleSelectQuality(-1)}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
              selectedQuality === -1
                ? 'bg-sky-500 text-white font-bold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span>Auto (Adaptive Bitrate)</span>
            {selectedQuality === -1 && <Check className="w-3.5 h-3.5" />}
          </button>
          {qualityLevels.map((lvl) => (
            <button
              key={lvl.index}
              onClick={() => handleSelectQuality(lvl.index)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                selectedQuality === lvl.index
                  ? 'bg-sky-500 text-white font-bold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span>{lvl.label}</span>
              {selectedQuality === lvl.index && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}

      {/* Top Header Bar (Appears when controls are shown) */}
      <div
        className={`absolute top-0 inset-x-0 p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent transition-opacity duration-300 z-30 flex items-center justify-between ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-4">
          <button
            id="btn-player-back"
            onClick={() => {
              recordProgress();
              onClose();
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-700 text-white hover:bg-slate-800 hover:border-slate-500 tv-focus transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-semibold">Back [ESC]</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                {item.name}
              </h2>
              {item.is4k && (
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-mono">
                  4K ULTRA HD
                </span>
              )}
              {isLive && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white tracking-wide">
                  LIVE STREAM
                </span>
              )}
            </div>
            {isSeries && seriesContext && (
              <p className="text-xs text-sky-400 font-medium">
                Season {seriesContext.seasonNum}, Episode {seriesContext.episode.episode_num}
              </p>
            )}
          </div>
        </div>

        {/* Top Right Badges & Quick Episodes button */}
        <div className="flex items-center gap-2">
          {isSeries && (
            <button
              id="btn-header-quick-episodes"
              onClick={() => setShowEpisodeMenu(!showEpisodeMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500 text-sky-300 hover:text-white border border-sky-500/40 text-xs font-semibold tv-focus transition-all"
            >
              <Clapperboard className="w-3.5 h-3.5" />
              <span>Episodes</span>
            </button>
          )}
          <span className="text-xs font-mono text-slate-300 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
            {currentQualityLabel}
          </span>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-1 rounded-lg border border-emerald-800/60">
            HW Decoded
          </span>
        </div>
      </div>

      {/* Bottom Controls Bar (OSD) */}
      <div
        className={`absolute bottom-0 inset-x-0 p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 z-30 space-y-3 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber Bar for VOD & Series */}
        {!isLive && (
          <div className="space-y-1">
            <div
              id="timeline-scrubber-track"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                if (videoRef.current && duration > 0) {
                  videoRef.current.currentTime = pos * duration;
                  setCurrentTime(pos * duration);
                  triggerControls();
                }
              }}
              className="relative w-full h-3 bg-slate-800/90 rounded-full cursor-pointer overflow-hidden group hover:h-4 transition-all"
            >
              {/* Buffer Bar */}
              <div
                className="absolute inset-y-0 left-0 bg-slate-600/60 transition-all"
                style={{ width: `${bufferPercent}%` }}
              />
              {/* Progress Bar */}
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-75"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
              <span>{formatTime(currentTime)}</span>
              <span className="text-[11px] text-slate-300">
                Use Remote / Arrow Keys to seek 10s
              </span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        {/* Controls Button Row */}
        <div className="flex items-center justify-between pt-1">
          {/* Left Controls: Play/Pause, 10s Seek */}
          <div className="flex items-center gap-3">
            <button
              id="btn-player-play-pause"
              onClick={togglePlay}
              className="w-11 h-11 rounded-xl bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center shadow-lg shadow-sky-500/30 tv-focus transition-transform"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            {!isLive && (
              <>
                <button
                  id="btn-player-seek-back-10"
                  onClick={() => handleSeek(-10)}
                  className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 tv-focus transition-all flex items-center gap-1 text-xs font-semibold"
                  title="Seek 10s backward"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>10s</span>
                </button>

                <button
                  id="btn-player-seek-forward-10"
                  onClick={() => handleSeek(10)}
                  className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 tv-focus transition-all flex items-center gap-1 text-xs font-semibold"
                  title="Seek 10s forward"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>10s</span>
                </button>
              </>
            )}

            {/* Volume toggle */}
            <button
              id="btn-player-mute-toggle"
              onClick={() => {
                if (!videoRef.current) return;
                videoRef.current.muted = !videoRef.current.muted;
                setIsMuted(videoRef.current.muted);
              }}
              className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white tv-focus"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          {/* Right Controls: In-player Episodes, Quality, Aspect Ratio, Fullscreen */}
          <div className="flex items-center gap-2.5">
            {/* In-Player Episodes Menu (for Series) */}
            {isSeries && (
              <button
                id="btn-in-player-episodes"
                onClick={() => setShowEpisodeMenu(!showEpisodeMenu)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all tv-focus ${
                  showEpisodeMenu
                    ? 'bg-sky-500 text-white border-sky-400 shadow-lg shadow-sky-500/30'
                    : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:text-white'
                }`}
                title="Series Episodes"
              >
                <Clapperboard className="w-4 h-4 text-sky-400" />
                <span>Episodes</span>
              </button>
            )}

            {/* Quality ABR Selector */}
            {qualityLevels.length > 0 && (
              <button
                id="btn-player-quality-toggle"
                onClick={() => setShowQualityMenu(!showQualityMenu)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold tv-focus"
              >
                <Sliders className="w-3.5 h-3.5 text-sky-400" />
                <span>{currentQualityLabel}</span>
              </button>
            )}

            {/* Subtitles toggle */}
            <button
              id="btn-player-subtitles-toggle"
              onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
              className={`p-2.5 rounded-xl border text-xs font-semibold tv-focus transition-all flex items-center gap-1.5 ${
                selectedSubtitleTrack !== -1 || showSubtitleMenu
                  ? 'bg-sky-500 text-white border-sky-400'
                  : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Subtitles & Captions"
            >
              <Subtitles className="w-4 h-4" />
              <span className="hidden sm:inline">
                {selectedSubtitleTrack === -1 ? 'Subtitles' : 'CC On'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
