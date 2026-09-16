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
  small: 'Small (100%)',
  medium: 'Medium (125%)',
  large: 'Large (150%)',
  huge: 'Huge (180% - Default)',
  maximum: 'Maximum (210%)',
};

export function useStorage() {
  const [tvFontSize, setTvFontSizeState] = useState<TvFontSize>(() => {
    try {
      const saved = localStorage.getItem(FONT_SIZE_KEY) as TvFontSize;
      if (saved && ['small', 'medium', 'large', 'huge', 'maximum'].includes(saved)) {
        return saved;
      }
    } catch {}
    return 'huge'; // Default to Huge (180%) optimized for 70" TVs!
  });

  const setTvFontSize = useCallback((size: TvFontSize) => {
    setTvFontSizeState(size);
    try {
      localStorage.setItem(FONT_SIZE_KEY, size);
      document.documentElement.setAttribute('data-tv-font', size);
      document.documentElement.style.fontSize = FONT_SCALES[size] || '180%';
    } catch (e) {
      console.error('Failed to save font size', e);
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-tv-font', tvFontSize);
      document.documentElement.style.fontSize = FONT_SCALES[tvFontSize] || '180%';
    } catch (e) {}
  }, [tvFontSize]);

  const [favorites, setFavorites] = useState<ContentItem[]>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [watchlist, setWatchlist] = useState<ContentItem[]>(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [continueWatching, setContinueWatching] = useState<PlaybackProgress[]>(() => {
    try {
      const saved = localStorage.getItem(PROGRESS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [watchedEpisodes, setWatchedEpisodes] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(WATCHED_EPISODES_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Save to localStorage when state changes
  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) {
      console.error('Failed to save favorites', e);
    }
  }, [favorites]);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch (e) {
      console.error('Failed to save watchlist', e);
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(continueWatching));
    } catch (e) {
      console.error('Failed to save continue watching', e);
    }
  }, [continueWatching]);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHED_EPISODES_KEY, JSON.stringify(watchedEpisodes));
    } catch (e) {
      console.error('Failed to save watched episodes', e);
    }
  }, [watchedEpisodes]);

  // Favorites handlers
  const toggleFavorite = useCallback((item: ContentItem) => {
    setFavorites((prev) => {
      const exists = prev.some((fav) => fav.id === item.id && fav.type === item.type);
      if (exists) {
        return prev.filter((fav) => !(fav.id === item.id && fav.type === item.type));
      } else {
        return [item, ...prev];
      }
    });
  }, []);

  const isFavorite = useCallback(
    (id: string | number, type: string) => {
      return favorites.some((fav) => fav.id === id && fav.type === type);
    },
    [favorites]
  );

  // Watchlist handlers
  const toggleWatchlist = useCallback((item: ContentItem) => {
    setWatchlist((prev) => {
      const exists = prev.some((w) => w.id === item.id && w.type === item.type);
      if (exists) {
        return prev.filter((w) => !(w.id === item.id && w.type === item.type));
      } else {
        return [item, ...prev];
      }
    });
  }, []);

  const isInWatchlist = useCallback(
    (id: string | number, type: string) => {
      return watchlist.some((w) => w.id === id && w.type === type);
    },
    [watchlist]
  );

  // Continue Watching handlers
  const updateProgress = useCallback((progress: PlaybackProgress) => {
    // For live TV channels, record into watch history immediately
    if (progress.type === 'live') {
      setContinueWatching((prev) => {
        const filtered = prev.filter(
          (p) => !(p.type === 'live' && String(p.id) === String(progress.id))
        );
        return [
          { ...progress, timestamp: 1, duration: 1, lastUpdated: Date.now() },
          ...filtered,
        ].slice(0, 50);
      });
      return;
    }

    // Only track if timestamp is > 5s and not at very end (>95%)
    if (progress.duration > 0 && progress.timestamp / progress.duration > 0.95) {
      // Mark as finished, remove from continue watching
      setContinueWatching((prev) => prev.filter((p) => p.id !== progress.id));
      return;
    }

    if (progress.timestamp < 5) return;

    setContinueWatching((prev) => {
      const filtered = prev.filter((p) => p.id !== progress.id);
      return [{ ...progress, lastUpdated: Date.now() }, ...filtered].slice(0, 50);
    });
  }, []);

  const getProgress = useCallback(
    (id: string | number) => {
      return continueWatching.find((p) => String(p.id) === String(id)) || null;
    },
    [continueWatching]
  );

  const removeProgress = useCallback((id: string | number) => {
    setContinueWatching((prev) => prev.filter((p) => String(p.id) !== String(id)));
  }, []);

  // Watched Episode Tracker
  const makeEpisodeKey = (seriesId: number, seasonNum: number, episodeNum: number) =>
    `${seriesId}_s${seasonNum}_e${episodeNum}`;

  const toggleEpisodeWatched = useCallback(
    (seriesId: number, seasonNum: number, episodeNum: number) => {
      const key = makeEpisodeKey(seriesId, seasonNum, episodeNum);
      setWatchedEpisodes((prev) => ({
        ...prev,
        [key]: !prev[key],
      }));
    },
    []
  );

  const isEpisodeWatched = useCallback(
    (seriesId: number, seasonNum: number, episodeNum: number) => {
      const key = makeEpisodeKey(seriesId, seasonNum, episodeNum);
      return !!watchedEpisodes[key];
    },
    [watchedEpisodes]
  );

  const getSeasonProgress = useCallback(
    (seriesId: number, seasonNum: number, totalEpisodes: number) => {
      if (!totalEpisodes) return { watchedCount: 0, total: 0, percentage: 0 };
      let count = 0;
      for (let i = 1; i <= totalEpisodes; i++) {
        if (watchedEpisodes[makeEpisodeKey(seriesId, seasonNum, i)]) {
          count++;
        }
      }
      return {
        watchedCount: count,
        total: totalEpisodes,
        percentage: Math.round((count / totalEpisodes) * 100),
      };
    },
    [watchedEpisodes]
  );

  // Clear Collections
  const clearFavorites = useCallback((type?: string) => {
    if (type) {
      setFavorites((prev) => prev.filter((f) => f.type !== type));
    } else {
      setFavorites([]);
    }
  }, []);

  const clearWatchlist = useCallback((type?: string) => {
    if (type) {
      setWatchlist((prev) => prev.filter((w) => w.type !== type));
    } else {
      setWatchlist([]);
    }
  }, []);

  const clearContinueWatching = useCallback((type?: string) => {
    if (type) {
      setContinueWatching((prev) => prev.filter((p) => p.type !== type));
    } else {
      setContinueWatching([]);
    }
  }, []);

  // Get specific episode playback progress
  const getEpisodeProgress = useCallback(
    (seriesId: number, seasonNum: number, episodeNum: number, episodeId?: string | number) => {
      return (
        continueWatching.find((p) => {
          if (episodeId && String(p.episodeId) === String(episodeId)) return true;
          return (
            p.seriesId === seriesId &&
            p.seasonNum === seasonNum &&
            p.episodeNum === episodeNum
          );
        }) || null
      );
    },
    [continueWatching]
  );

  // Get most recent progress for a series
  const getSeriesProgress = useCallback(
    (seriesId: number) => {
      const items = continueWatching.filter((p) => p.seriesId === seriesId);
      if (items.length === 0) return null;
      return items.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))[0];
    },
    [continueWatching]
  );

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
