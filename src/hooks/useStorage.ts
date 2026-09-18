import { useState, useEffect, useCallback } from 'react';
import { PlaybackProgress, ContentItem, WatchedEpisodeRecord, TvFontSize } from '../types';

const FAVORITES_KEY = 'webos_xtream_favorites';
const WATCHLIST_KEY = 'webos_xtream_watchlist';
const PROGRESS_KEY = 'webos_xtream_continue_watching';
const WATCHED_EPISODES_KEY = 'webos_xtream_watched_episodes';
const FONT_SIZE_KEY = 'webos_tv_font_size';

export const FONT_SCALES: Record<TvFontSize, string> = {
  small: '100%',
  medium: '125%',
  large: '150%',
  huge: '180%',
  maximum: '210%',
};

export const FONT_NAMES: Record<TvFontSize, string> = {
  small: 'Small (100% - Mobile Default)',
  medium: 'Medium (125%)',
  large: 'Large (150%)',
  huge: 'Huge (180% - TV Default)',
  maximum: 'Maximum (210%)',
};

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const isSmallScreen = window.innerWidth <= 768;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent
  );
  return isSmallScreen || window.matchMedia('(pointer: coarse)').matches || isMobileUA;
}

function getInitialTvFontSize(): TvFontSize {
  try {
    const isMobile = isMobileDevice();
    const userSelected = localStorage.getItem('tv_font_user_selected');
    const saved = localStorage.getItem(FONT_SIZE_KEY) as TvFontSize;

    // If the user explicitly picked a font size from the dropdown, respect it
    if (userSelected && saved && ['small', 'medium', 'large', 'huge', 'maximum'].includes(saved)) {
      return saved;
    }

    // On mobile devices, default scaling is 100% ('small')
    if (isMobile) {
      return 'small';
    }

    if (saved && ['small', 'medium', 'large', 'huge', 'maximum'].includes(saved)) {
      return saved;
    }
  } catch {}
  return 'huge';
}

function normalizeTranscodedProgress(progress: PlaybackProgress): PlaybackProgress {
  if (progress.type === 'live' || typeof window === 'undefined') return progress;
  if (!(window as any).__xtreamCurrentTimeBridgeInstalled) return progress;

  try {
    const parsed = new URL(progress.streamUrl || '', window.location.href);
    if (!parsed.pathname.endsWith('/api/xtream/stream')) return progress;
    const start = Number(parsed.searchParams.get('start') || '0');
    if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(progress.timestamp)) return progress;

    // VideoPlayer currently reads the logical (offset-adjusted) currentTime and then
    // adds the source start offset once more when saving. Correct that duplicate
    // offset at the storage boundary so resume always receives the true absolute time.
    return { ...progress, timestamp: Math.max(start, progress.timestamp - start) };
  } catch {
    return progress;
  }
}

export function useStorage() {
  const [tvFontSize, setTvFontSizeState] = useState<TvFontSize>(getInitialTvFontSize);

  const setTvFontSize = useCallback((size: TvFontSize) => {
    setTvFontSizeState(size);
    try {
      localStorage.setItem(FONT_SIZE_KEY, size);
      localStorage.setItem('tv_font_user_selected', 'true');
      document.documentElement.setAttribute('data-tv-font', size);
      document.documentElement.style.fontSize = FONT_SCALES[size] || '100%';
    } catch (e) {
      console.error('Failed to save font size', e);
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-tv-font', tvFontSize);
      document.documentElement.style.fontSize = FONT_SCALES[tvFontSize] || '100%';
    } catch (e) {}
  }, [tvFontSize]);

  const [favorites, setFavorites] = useState<ContentItem[]>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [watchlist, setWatchlist] = useState<ContentItem[]>(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [continueWatching, setContinueWatching] = useState<PlaybackProgress[]>(() => {
    try {
      const saved = localStorage.getItem(PROGRESS_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.map((entry) => normalizeTranscodedProgress(entry)) : [];
    } catch { return []; }
  });

  const continueWatchingRef = useRef<PlaybackProgress[]>(continueWatching);

  const commitContinueWatching = useCallback((
    nextOrUpdater:
      | PlaybackProgress[]
      | ((previous: PlaybackProgress[]) => PlaybackProgress[])
  ) => {
    const previous = continueWatchingRef.current;
    const next =
      typeof nextOrUpdater === 'function'
        ? nextOrUpdater(previous)
        : nextOrUpdater;

    continueWatchingRef.current = next;
    setContinueWatching(next);
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to save playback progress', e);
    }
  }, []);

  const [watchedEpisodes, setWatchedEpisodes] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(WATCHED_EPISODES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  useEffect(() => {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); }
    catch (e) { console.error('Failed to save favorites', e); }
  }, [favorites]);

  useEffect(() => {
    try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }
    catch (e) { console.error('Failed to save watchlist', e); }
  }, [watchlist]);

  useEffect(() => {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(continueWatching)); }
    catch (e) { console.error('Failed to save continue watching', e); }
  }, [continueWatching]);

  useEffect(() => {
    try { localStorage.setItem(WATCHED_EPISODES_KEY, JSON.stringify(watchedEpisodes)); }
    catch (e) { console.error('Failed to save watched episodes', e); }
  }, [watchedEpisodes]);

  const toggleFavorite = useCallback((item: ContentItem) => {
    setFavorites((prev) => {
      const exists = prev.some((fav) => fav.id === item.id && fav.type === item.type);
      return exists ? prev.filter((fav) => !(fav.id === item.id && fav.type === item.type)) : [item, ...prev];
    });
  }, []);

  const isFavorite = useCallback((id: string | number, type: string) => favorites.some((fav) => fav.id === id && fav.type === type), [favorites]);

  const toggleWatchlist = useCallback((item: ContentItem) => {
    setWatchlist((prev) => {
      const exists = prev.some((w) => w.id === item.id && w.type === item.type);
      return exists ? prev.filter((w) => !(w.id === item.id && w.type === item.type)) : [item, ...prev];
    });
  }, []);

  const isInWatchlist = useCallback((id: string | number, type: string) => watchlist.some((w) => w.id === id && w.type === type), [watchlist]);

  const updateProgress = useCallback((incoming: PlaybackProgress) => {
    const progress = normalizeTranscodedProgress(incoming);

    if (progress.type === 'live') {
      commitContinueWatching((prev) => {
        const filtered = prev.filter((p) => !(p.type === 'live' && String(p.id) === String(progress.id)));
        return [{ ...progress, timestamp: 1, duration: 1, lastUpdated: Date.now() }, ...filtered].slice(0, 50);
      });
      return;
    }

    if (progress.duration > 0 && progress.timestamp / progress.duration > 0.95) {
      commitContinueWatching((prev) =>
        prev.filter((p) => !(p.type === progress.type && String(p.id) === String(progress.id)))
      );
      return;
    }
    if (progress.timestamp < 5) return;

    commitContinueWatching((prev) => {
      const filtered = prev.filter(
        (p) => !(p.type === progress.type && String(p.id) === String(progress.id))
      );
      return [{ ...progress, lastUpdated: Date.now() }, ...filtered].slice(0, 50);
    });
  }, [commitContinueWatching]);

  const getProgress = useCallback(
    (id: string | number, type?: string) =>
      continueWatching.find(
        (p) => String(p.id) === String(id) && (!type || p.type === type)
      ) || null,
    [continueWatching]
  );
  const removeProgress = useCallback((id: string | number) => {
    commitContinueWatching((prev) => prev.filter((p) => String(p.id) !== String(id)));
  }, [commitContinueWatching]);

  const makeEpisodeKey = (seriesId: number, seasonNum: number, episodeNum: number) => `${seriesId}_s${seasonNum}_e${episodeNum}`;

  const toggleEpisodeWatched = useCallback((seriesId: number, seasonNum: number, episodeNum: number) => {
    const key = makeEpisodeKey(seriesId, seasonNum, episodeNum);
    setWatchedEpisodes((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isEpisodeWatched = useCallback((seriesId: number, seasonNum: number, episodeNum: number) => !!watchedEpisodes[makeEpisodeKey(seriesId, seasonNum, episodeNum)], [watchedEpisodes]);

  const getSeasonProgress = useCallback((seriesId: number, seasonNum: number, totalEpisodes: number) => {
    if (!totalEpisodes) return { watchedCount: 0, total: 0, percentage: 0 };
    let count = 0;
    for (let i = 1; i <= totalEpisodes; i++) if (watchedEpisodes[makeEpisodeKey(seriesId, seasonNum, i)]) count++;
    return { watchedCount: count, total: totalEpisodes, percentage: Math.round((count / totalEpisodes) * 100) };
  }, [watchedEpisodes]);

  const clearFavorites = useCallback((type?: string) => {
    if (type) setFavorites((prev) => prev.filter((f) => f.type !== type));
    else setFavorites([]);
  }, []);

  const clearWatchlist = useCallback((type?: string) => {
    if (type) setWatchlist((prev) => prev.filter((w) => w.type !== type));
    else setWatchlist([]);
  }, []);

  const clearContinueWatching = useCallback((type?: string) => {
    if (type) commitContinueWatching((prev) => prev.filter((p) => p.type !== type));
    else commitContinueWatching([]);
  }, [commitContinueWatching]);

  const getEpisodeProgress = useCallback((seriesId: number, seasonNum: number, episodeNum: number, episodeId?: string | number) => {
    return continueWatching.find((p) => {
      if (episodeId && String(p.episodeId) === String(episodeId)) return true;
      return p.seriesId === seriesId && p.seasonNum === seasonNum && p.episodeNum === episodeNum;
    }) || null;
  }, [continueWatching]);

  const getSeriesProgress = useCallback((seriesId: number) => {
    const items = continueWatching.filter((p) => p.seriesId === seriesId);
    if (items.length === 0) return null;
    return items.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))[0];
  }, [continueWatching]);

  return {
    favorites,
    watchlist,
    continueWatching,
    toggleFavorite,
    isFavorite,
    clearFavorites,
    toggleWatchlist,
    isInWatchlist,
    clearWatchlist,
    updateProgress,
    getProgress,
    removeProgress,
    clearContinueWatching,
    getEpisodeProgress,
    getSeriesProgress,
    toggleEpisodeWatched,
    isEpisodeWatched,
    getSeasonProgress,
    tvFontSize,
    setTvFontSize,
  };
}
