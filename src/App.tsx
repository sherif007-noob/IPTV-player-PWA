import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Tv,
  Film,
  Clapperboard,
  Star,
  Bookmark,
  History,
  Search,
  Settings,
  Sparkles,
  RefreshCw,
  Layers,
  Wifi,
  X,
  Play,
  LogOut,
  Trash2,
} from 'lucide-react';

import {
  MainNavView,
  ContentType,
  ContentItem,
  LiveChannel,
  VodMovie,
  SeriesItem,
  XtreamCategory,
  Episode,
  PlaybackProgress,
  TvFontSize,
} from './types';
import { xtreamService } from './services/xtream';
import { useStorage } from './hooks/useStorage';
import { useWebOSRemote } from './hooks/useWebOSRemote';
import { AppHeader } from './components/AppHeader';
import { HomePortal } from './components/HomePortal';
import { CategorySidebar } from './components/CategorySidebar';
import { StreamCard } from './components/StreamCard';
import { DetailsModal } from './components/DetailsModal';
import { VideoPlayer } from './components/VideoPlayer';
import { ServerLoginModal } from './components/ServerLoginModal';
import { RemoteControlHUD } from './components/RemoteControlHUD';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ModalShell } from './components/ModalShell';

export default function App() {
  const storage = useStorage();
  const isWebOSRuntime = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return !!(window as any).webOS || /web0s|webos/i.test(navigator.userAgent);
  }, []);
  const isStandalonePwa = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches ||
      !!(navigator as any).standalone;
  }, []);
  const showRemoteHud = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return isWebOSRuntime || new URLSearchParams(window.location.search).get('remoteHud') === '1';
  }, [isWebOSRuntime]);

  // Navigation state: 'home' is the default starting page
  const [currentView, setCurrentView] = useState<MainNavView | 'home'>('home');
  const [viewHistory, setViewHistory] = useState<(MainNavView | 'home')[]>(['home']);

  // Category and Content state
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [liveChannels, setLiveChannels] = useState<LiveChannel[]>([]);
  const [movies, setMovies] = useState<VodMovie[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  const [isCompactNavigation, setIsCompactNavigation] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 768;
  });

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const syncNavigationMode = () => {
      const compact = media.matches;
      setIsCompactNavigation(compact);
      setIsSidebarOpen(!compact);
    };
    syncNavigationMode();
    media.addEventListener?.('change', syncNavigationMode);
    return () => media.removeEventListener?.('change', syncNavigationMode);
  }, []);

  // Search state (Header searchbar)
  const [headerSearchQuery, setHeaderSearchQuery] = useState<string>('');

  useEffect(() => {
    if (isCompactNavigation && headerSearchQuery.trim()) {
      setIsSidebarOpen(false);
    }
  }, [headerSearchQuery, isCompactNavigation]);

  // Active Modals and Player
  const [selectedDetailsItem, setSelectedDetailsItem] = useState<ContentItem | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const lastBackPressTimeRef = useRef<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  // Player state
  const [activePlayer, setActivePlayer] = useState<{
    item: ContentItem;
    streamUrl: string;
    initialTime: number;
    seriesContext?: {
      seriesId: number;
      seasonNum: number;
      episode: Episode;
      allEpisodes?: Episode[];
    };
  } | null>(null);

  // Auth / Server state
  const [credentials, setCredentials] = useState(xtreamService.getCredentials());
  const [userInfo, setUserInfo] = useState(xtreamService.getUserInfo());
  const [serverInfo, setServerInfo] = useState(xtreamService.getServerInfo());
  const [isDemo, setIsDemo] = useState(xtreamService.getIsDemo());

  // Listen to automated refresh notifications
  useEffect(() => {
    xtreamService.setRefreshListener((msg) => {
      setRefreshNotice(msg);
      if (currentView !== 'home') {
        loadViewData(currentView as MainNavView, selectedCategoryId);
      }
      setTimeout(() => setRefreshNotice(null), 5000);
    });
  }, [currentView, selectedCategoryId]);

  const [loadingStatusText, setLoadingStatusText] = useState<string>('Loading content...');

  // Load Content based on View & Category (on-demand loading)
  const loadViewData = useCallback(
    async (view: MainNavView, catId: string = 'all') => {
      if (view === 'home' || view === 'favorites' || view === 'watchlist' || view === 'continue_watching') {
        return;
      }
      setIsLoadingContent(true);
      const isAll = catId === 'all' || catId.startsWith('special_');
      const viewLabel = view === 'vod' ? 'Movies (VOD)' : view === 'series' ? 'TV Series' : 'Live Channels';
      setLoadingStatusText(
        isAll
          ? `Loading ${viewLabel} catalog...`
          : `Filtering category in ${viewLabel}...`
      );

      try {
        if (view === 'live') {
          const cats = await xtreamService.getCategories('live');
          setCategories(cats);
          const streams = await xtreamService.getLiveStreams(catId);
          setLiveChannels(streams);
        } else if (view === 'vod') {
          const cats = await xtreamService.getCategories('vod');
          setCategories(cats);
          const vodList = await xtreamService.getVodStreams(catId);
          setMovies(vodList);
        } else if (view === 'series') {
          const cats = await xtreamService.getCategories('series');
          setCategories(cats);
          const sList = await xtreamService.getSeries(catId);
          setSeries(sList);
        }
      } catch (err: any) {
        console.error('Error loading content:', err);
        setRefreshNotice(`Error: ${err.message || 'Failed to load library'}`);
      } finally {
        setIsLoadingContent(false);
      }
    },
    []
  );

  // Initial load: Fast authentication and content refresh on startup
  useEffect(() => {
    const init = async () => {
      setIsRefreshing(true);
      try {
        const auth = await xtreamService.authenticate();
        setUserInfo(auth.user_info);
        setServerInfo(auth.server_info);
        setCredentials(xtreamService.getCredentials());
        setIsDemo(xtreamService.getIsDemo());

        // Refresh categories and initial live stream catalog on startup
        const [liveCats, vodCats, seriesCats, liveStreams] = await Promise.allSettled([
          xtreamService.getCategories('live'),
          xtreamService.getCategories('vod'),
          xtreamService.getCategories('series'),
          xtreamService.getLiveStreams('all'),
        ]);

        if (liveStreams.status === 'fulfilled') setLiveChannels(liveStreams.value);
        if (liveCats.status === 'fulfilled') setCategories(liveCats.value);

        // Preload VOD & Series in background without blocking initial UI interactivity
        setTimeout(() => {
          xtreamService.getVodStreams('all').then((vods) => {
            if (vods && vods.length > 0) setMovies(vods);
          }).catch((err) => console.warn('Background VOD preload notice:', err.message));

          xtreamService.getSeries('all').then((sList) => {
            if (sList && sList.length > 0) setSeries(sList);
          }).catch((err) => console.warn('Background Series preload notice:', err.message));
        }, 1000);
      } catch (err) {
        console.warn('Initial authentication attempt:', err);
        setCredentials(xtreamService.getCredentials());
        setUserInfo(xtreamService.getUserInfo());
        setServerInfo(xtreamService.getServerInfo());
        setIsDemo(xtreamService.getIsDemo());
      } finally {
        setIsRefreshing(false);
      }
    };
    init();
  }, []);

  // Navigation handlers
  const handleSelectView = (view: MainNavView, initialCategoryId: string = 'all') => {
    setViewHistory((prev) => (prev[prev.length - 1] === view ? prev : [...prev, view]));
    setCurrentView(view);
    if (isCompactNavigation) setIsSidebarOpen(false);
    setSelectedCategoryId(initialCategoryId);
    setHeaderSearchQuery('');
    loadViewData(view, initialCategoryId.startsWith('special_') ? 'all' : initialCategoryId);
  };

  const handleNavigateHome = () => {
    setViewHistory((prev) => (prev[prev.length - 1] === 'home' ? prev : [...prev, 'home']));
    setCurrentView('home');
    if (isCompactNavigation) setIsSidebarOpen(false);
    setSelectedCategoryId('all');
    setHeaderSearchQuery('');
  };

  // Toggle Categories Sidebar
  const handleToggleSidebar = () => {
    if (currentView === 'home') {
      handleSelectView('live');
      if (isCompactNavigation) {
        window.setTimeout(() => setIsSidebarOpen(true), 0);
      }
      return;
    }
    setIsSidebarOpen((prev) => !prev);
  };

  // Category Selection
  const handleSelectCategory = (catId: string) => {
    setSelectedCategoryId(catId);
    if (isCompactNavigation) setIsSidebarOpen(false);
    if (currentView !== 'home') {
      if (catId.startsWith('special_')) {
        // Ensure section content is loaded
        loadViewData(currentView as MainNavView, 'all');
      } else {
        loadViewData(currentView as MainNavView, catId);
      }
    }
  };

  // Manual Refresh Handler
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    setRefreshNotice('Refreshing credentials & Xtream playlists...');
    try {
      xtreamService.clearCache();
      await xtreamService.authenticate();
      setUserInfo(xtreamService.getUserInfo());
      setServerInfo(xtreamService.getServerInfo());
      if (currentView !== 'home') {
        await loadViewData(currentView as MainNavView, selectedCategoryId);
      } else {
        await Promise.allSettled([
          xtreamService.getCategories('live'),
          xtreamService.getCategories('vod'),
          xtreamService.getCategories('series'),
        ]);
      }
      setRefreshNotice('Content refreshed successfully.');
    } catch (e: any) {
      setRefreshNotice(`Notice: ${e.message}`);
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setRefreshNotice(null), 4000);
    }
  };

  // Playback Starter
  const handleStartPlay = (
    item: ContentItem,
    startTime: number = 0,
    seriesMeta?: {
      seriesId: number;
      seasonNum: number;
      episode: Episode;
      allEpisodes?: Episode[];
    }
  ) => {
    let url = '';
    if (item.type === 'live') {
      const channel = liveChannels.find((c) => c.stream_id === Number(item.id));
      url = channel?.direct_source || xtreamService.getStreamUrl('live', item.id);
    } else if (item.type === 'vod') {
      const ext = item.container_extension;
      url = xtreamService.getStreamUrl('vod', item.id, ext);
    } else if (item.type === 'series' && seriesMeta) {
      const ext = seriesMeta.episode.container_extension;
      url = xtreamService.getStreamUrl('series', seriesMeta.episode.id, ext);
    }

    setActivePlayer({
      item,
      streamUrl: url,
      initialTime: startTime,
      seriesContext: seriesMeta
        ? {
            seriesId: seriesMeta.seriesId,
            seasonNum: seriesMeta.seasonNum,
            episode: seriesMeta.episode,
            allEpisodes: seriesMeta.allEpisodes,
          }
        : undefined,
    });
  };

  // Card click router: Live plays directly; Movie/Series opens Details Modal
  const handleSelectCard = (item: ContentItem) => {
    if (item.type === 'live') {
      handleStartPlay(item, 0);
    } else {
      setSelectedDetailsItem(item);
    }
  };

  // LG WebOS Platform Exit Handler
  const handleExitApp = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        const webOS = (window as any).webOS;
        if (webOS?.platformBack) {
          webOS.platformBack();
          return;
        }
        window.close();
      }
    } catch (e) {
      console.warn('Exit app handler:', e);
    }
  }, []);

  // LG WebOS Consistent Back Button Behavior
  const handleBackNavigation = useCallback(() => {
    // 0. Close Exit confirmation modal if open
    if (showExitConfirm) {
      setShowExitConfirm(false);
      return;
    }

    // 1. Close active video player
    if (activePlayer) {
      setActivePlayer(null);
      return;
    }

    // 2. Close Details modal
    if (selectedDetailsItem) {
      setSelectedDetailsItem(null);
      return;
    }

    // 3. Close Settings modal
    if (isSettingsOpen) {
      setIsSettingsOpen(false);
      return;
    }

    // 4. Close the compact category drawer before changing navigation state
    if (isCompactNavigation && isSidebarOpen) {
      setIsSidebarOpen(false);
      return;
    }

    // 5. Clear search query if active
    if (headerSearchQuery.trim()) {
      setHeaderSearchQuery('');
      return;
    }

    // 6. Reset category filter to 'all' if filtered
    if (selectedCategoryId !== 'all') {
      setSelectedCategoryId('all');
      if (currentView !== 'home') {
        loadViewData(currentView as MainNavView, 'all');
      }
      return;
    }

    // 7. Return to Home starting portal if inside a section.
    // Reset stale section history so the next Back is meaningful.
    if (currentView !== 'home') {
      setCurrentView('home');
      setSelectedCategoryId('all');
      setHeaderSearchQuery('');
      setViewHistory(['home']);
      return;
    }

    // 8. Pop view history
    if (viewHistory.length > 1) {
      const newHistory = [...viewHistory];
      newHistory.pop();
      const prev = newHistory[newHistory.length - 1];
      setViewHistory(newHistory);
      setCurrentView(prev);
      return;
    }

    // 9. If at root Home view with nothing left to back out of:
    // Support double-click back to exit directly, or show confirmation dialog
    const now = Date.now();
    if (now - lastBackPressTimeRef.current < 2500) {
      handleExitApp();
      return;
    }
    lastBackPressTimeRef.current = now;
    setShowExitConfirm(true);
  }, [
    showExitConfirm,
    activePlayer,
    selectedDetailsItem,
    isSettingsOpen,
    isCompactNavigation,
    isSidebarOpen,
    headerSearchQuery,
    selectedCategoryId,
    currentView,
    viewHistory,
    loadViewData,
    handleExitApp,
  ]);

  // Trap platform-back only in webOS / installed PWA mode.
  // Normal Safari/desktop browser history remains native instead of being permanently re-pushed.
  useEffect(() => {
    if (!isWebOSRuntime && !isStandalonePwa) return;
    try {
      window.history.replaceState({ app: 'iptv_root' }, '');
      window.history.pushState({ app: 'iptv_guard' }, '');
      const handlePopState = (event: PopStateEvent) => {
        event.preventDefault();
        handleBackNavigation();
        window.history.pushState({ app: 'iptv_guard' }, '');
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    } catch {}
  }, [handleBackNavigation, isStandalonePwa, isWebOSRuntime]);

  // Resume in-progress titles from HomePortal Jump Back In
  const handleResumeProgress = useCallback(
    (recent: PlaybackProgress) => {
      if (recent.type === 'live') {
        const channel = liveChannels.find((c) => c.stream_id === Number(recent.id)) || {
          stream_id: Number(recent.id),
          name: recent.title,
          category_id: 'all',
          stream_icon: recent.poster,
        };
        handleStartPlay(
          {
            id: channel.stream_id,
            type: 'live',
            name: channel.name,
            category_id: channel.category_id,
            icon: channel.stream_icon,
          },
          0
        );
      } else if (recent.type === 'vod') {
        const movie = movies.find((m) => m.stream_id === Number(recent.id)) || {
          stream_id: Number(recent.id),
          name: recent.title,
          category_id: 'all',
          stream_icon: recent.poster,
        };
        handleStartPlay(
          {
            id: movie.stream_id,
            type: 'vod',
            name: movie.name,
            category_id: movie.category_id,
            icon: movie.stream_icon,
            container_extension: (movie as any).container_extension || 'mp4',
          },
          recent.timestamp
        );
      } else if (recent.type === 'series') {
        const seriesId = Number(recent.seriesId || recent.id);
        const matchedSeries = series.find((s) => Number(s.series_id) === seriesId) || {
          series_id: seriesId,
          name: recent.title,
          category_id: 'all',
          cover: recent.poster,
        };
        const epObj: Episode = {
          id: recent.episodeId || recent.id,
          episode_num: recent.episodeNum || 1,
          title: recent.subtitle || `Episode ${recent.episodeNum || 1}`,
          season: recent.seasonNum || 1,
          info: { duration_secs: recent.duration },
        };
        handleStartPlay(
          {
            id: matchedSeries.series_id,
            type: 'series',
            name: matchedSeries.name,
            category_id: matchedSeries.category_id,
            icon: matchedSeries.cover,
          },
          recent.timestamp,
          {
            seriesId,
            seasonNum: Number(recent.seasonNum || 1),
            episode: epObj,
          }
        );
      }
    },
    [liveChannels, movies, series, handleStartPlay]
  );

  // Hook up WebOS Magic Remote keys:
  // Red = Live TV, Green = Movies, Yellow = Series, Blue = Search
  useWebOSRemote({
    onBack: handleBackNavigation,
    onColorRed: () => handleSelectView('live'),
    onColorGreen: () => handleSelectView('vod'),
    onColorYellow: () => handleSelectView('series'),
    onColorBlue: () => {
      const input = document.getElementById('header-search-input');
      input?.focus();
    },
  }, !!activePlayer);

  // Memoize converted items per content type to prevent unnecessary re-allocations
  const liveContentItems = useMemo<ContentItem[]>(() => {
    return liveChannels.map((c) => ({
      id: c.stream_id,
      type: 'live',
      name: c.name,
      category_id: c.category_id,
      icon: c.stream_icon,
      is4k: c.is4k,
    }));
  }, [liveChannels]);

  const movieContentItems = useMemo<ContentItem[]>(() => {
    return movies.map((m) => ({
      id: m.stream_id,
      type: 'vod',
      name: m.name,
      category_id: m.category_id,
      icon: m.stream_icon,
      rating: m.rating,
      year: m.year,
      container_extension: m.container_extension,
      is4k: m.is4k,
    }));
  }, [movies]);

  const seriesContentItems = useMemo<ContentItem[]>(() => {
    return series.map((s) => ({
      id: s.series_id,
      type: 'series',
      name: s.name,
      category_id: s.category_id,
      icon: s.cover,
      rating: s.rating,
      year: s.releaseDate,
      plot: s.plot,
      cast: s.cast,
      director: s.director,
      genre: s.genre,
      is4k: s.is4k,
    }));
  }, [series]);

  // Unified items across all libraries (only computed when searching on Home)
  const allLibraryItems = useMemo<ContentItem[]>(() => {
    if (currentView !== 'home' || !headerSearchQuery.trim()) {
      return [];
    }
    return [...liveContentItems, ...movieContentItems, ...seriesContentItems];
  }, [currentView, headerSearchQuery, liveContentItems, movieContentItems, seriesContentItems]);

  // Items to display in the main grid
  const currentGridItems = useMemo<ContentItem[]>(() => {
    let items: ContentItem[] = [];

    if (currentView === 'live') {
      items = liveContentItems;
    } else if (currentView === 'vod') {
      items = movieContentItems;
    } else if (currentView === 'series') {
      items = seriesContentItems;
    } else if (currentView === 'favorites') {
      items = storage.favorites;
    } else if (currentView === 'watchlist') {
      items = storage.watchlist;
    } else if (currentView === 'continue_watching') {
      items = storage.continueWatching.map((p) => ({
        id: p.id,
        type: p.type,
        name: p.title,
        category_id: 'continue',
        icon: p.poster,
        seriesId: p.seriesId,
      }));
    }

    // Filter by Special Categories (Favorites, Continue Watching, Watchlist) or Server Category
    if (selectedCategoryId === 'special_favorites') {
      items = items.filter((item) => storage.isFavorite(item.id, item.type));
    } else if (selectedCategoryId === 'special_continue') {
      items = items.filter((item) => {
        return storage.continueWatching.some((p) => {
          if (item.type === 'series') {
            return p.seriesId === Number(item.id) || String(p.id) === String(item.id);
          }
          return String(p.id) === String(item.id) && p.type === item.type;
        });
      });
    } else if (selectedCategoryId === 'special_watchlist') {
      items = items.filter((item) => storage.isInWatchlist(item.id, item.type));
    } else if (selectedCategoryId !== 'all' && !selectedCategoryId.startsWith('special_')) {
      items = items.filter((item) => item.category_id === selectedCategoryId);
    }

    // Real-time search filter in header
    if (headerSearchQuery.trim()) {
      const q = headerSearchQuery.toLowerCase();
      const source = currentView === 'home' ? allLibraryItems : items;
      return source.filter((item) => {
        const nameMatch = item.name.toLowerCase().includes(q);
        const genreMatch = item.genre ? item.genre.toLowerCase().includes(q) : false;
        return nameMatch || genreMatch;
      });
    }

    return items;
  }, [
    currentView,
    liveContentItems,
    movieContentItems,
    seriesContentItems,
    storage,
    selectedCategoryId,
    headerSearchQuery,
    allLibraryItems,
  ]);

  // Pagination / Chunking: prevent rendering 10,000 DOM nodes at once which freezes TV webview
  const [visibleCount, setVisibleCount] = useState<number>(48);

  useEffect(() => {
    setVisibleCount(48);
  }, [currentView, selectedCategoryId, headerSearchQuery]);

  const displayedGridItems = useMemo(() => {
    return currentGridItems.slice(0, visibleCount);
  }, [currentGridItems, visibleCount]);

  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 600) {
      if (visibleCount < currentGridItems.length) {
        setVisibleCount((prev) => Math.min(prev + 48, currentGridItems.length));
      }
    }
  };

  // Section-specific counts for the category sidebar
  const sectionFavoritesCount = useMemo(() => {
    if (currentView === 'live' || currentView === 'vod' || currentView === 'series') {
      return storage.favorites.filter((f) => f.type === currentView).length;
    }
    return storage.favorites.length;
  }, [currentView, storage.favorites]);

  const sectionContinueCount = useMemo(() => {
    if (currentView === 'live' || currentView === 'vod' || currentView === 'series') {
      return storage.continueWatching.filter((c) => c.type === currentView).length;
    }
    return storage.continueWatching.length;
  }, [currentView, storage.continueWatching]);

  const sectionWatchlistCount = useMemo(() => {
    if (currentView === 'vod' || currentView === 'series') {
      return storage.watchlist.filter((w) => w.type === currentView).length;
    }
    return storage.watchlist.length;
  }, [currentView, storage.watchlist]);

  // Total items in current section for the "All" badge in category sidebar
  const sectionTotalCount = useMemo(() => {
    if (currentView === 'live') return liveChannels.length;
    if (currentView === 'vod') return movies.length;
    if (currentView === 'series') return series.length;
    return currentGridItems.length;
  }, [currentView, liveChannels.length, movies.length, series.length, currentGridItems.length]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sectionTotalCount };
    const rawList =
      currentView === 'live'
        ? liveChannels
        : currentView === 'vod'
        ? movies
        : currentView === 'series'
        ? series
        : [];

    rawList.forEach((item: any) => {
      const cat = item.category_id;
      if (cat) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    });
    return counts;
  }, [currentView, liveChannels, movies, series, sectionTotalCount]);

  // Only show the Category Sidebar when browsing Live TV, Movies, or Series
  const showCategorySidebar =
    currentView === 'live' || currentView === 'vod' || currentView === 'series';

  const selectedCategoryName = useMemo(() => {
    if (selectedCategoryId === 'special_favorites') return 'Favorites';
    if (selectedCategoryId === 'special_continue') return 'Continue Watching';
    if (selectedCategoryId === 'special_watchlist') return 'Watchlist';
    if (selectedCategoryId === 'all') return 'All Categories';
    return (
      categories.find((c) => c.category_id === selectedCategoryId)?.category_name ||
      selectedCategoryId
    );
  }, [selectedCategoryId, categories]);

  return (
    <div
      id="webos-iptv-root"
      className="flex flex-col h-full w-full bg-[#0b0e14] text-slate-100 overflow-hidden font-sans select-none"
    >
      {/* 1. Universal Top Header with Searchbar, Home button, Refresh & Settings */}
      <AppHeader
        currentView={currentView}
        onNavigateHome={handleNavigateHome}
        onSelectView={handleSelectView}
        searchQuery={headerSearchQuery}
        onSearchChange={setHeaderSearchQuery}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRefresh={handleManualRefresh}
        isRefreshing={isRefreshing}
        isDemo={isDemo}
        selectedCategoryName={selectedCategoryName}
        tvFontSize={storage.tvFontSize}
        onSelectFontSize={storage.setTvFontSize}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={handleToggleSidebar}
      />

      {/* 2. Main Body Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* If Home Starting Page is Active AND no search is being typed */}
        {currentView === 'home' && !headerSearchQuery.trim() ? (
          <HomePortal
            onSelectSection={handleSelectView}
            liveCount={liveChannels.length}
            moviesCount={movies.length}
            seriesCount={series.length}
            continueWatchingList={storage.continueWatching}
            onResumeRecent={handleResumeProgress}
            onClearContinueWatching={() => storage.clearContinueWatching()}
          />
        ) : (
          <>
            {/* The Category Sidebar for genres & categories from Xtream server */}
            {showCategorySidebar && !headerSearchQuery.trim() && (
              <>
                {/* Mobile Backdrop */}
                {isSidebarOpen && (
                  <div
                    id="sidebar-mobile-backdrop"
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 md:hidden"
                    aria-hidden="true"
                    onPointerDown={() => setIsSidebarOpen(false)}
                  />
                )}

                {/* Sidebar Drawer Container */}
                <div
                  id="category-sidebar-wrapper"
                  role={isCompactNavigation ? 'dialog' : undefined}
                  aria-modal={isCompactNavigation ? 'true' : undefined}
                  aria-label={isCompactNavigation ? 'Categories' : undefined}
                  className={`
                    fixed inset-y-0 left-0 top-0 z-40 md:static md:top-auto md:z-auto
                    h-[100dvh] md:h-full transition-transform duration-300 ease-in-out
                    ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'}
                  `}
                >
                  <CategorySidebar
                    title={
                      currentView === 'live'
                        ? 'Live TV'
                        : currentView === 'vod'
                        ? 'Movies'
                        : 'Series'
                    }
                    categories={categories}
                    selectedCategoryId={selectedCategoryId}
                    onSelectCategory={handleSelectCategory}
                    categoryCounts={categoryCounts}
                    favoritesCount={sectionFavoritesCount}
                    continueCount={sectionContinueCount}
                    watchlistCount={sectionWatchlistCount}
                    onClose={() => setIsSidebarOpen(false)}
                    onClearFavorites={() => {
                      if (currentView === 'live' || currentView === 'vod' || currentView === 'series') {
                        storage.clearFavorites(currentView);
                      } else {
                        storage.clearFavorites();
                      }
                    }}
                    onClearContinue={() => {
                      if (currentView === 'live' || currentView === 'vod' || currentView === 'series') {
                        storage.clearContinueWatching(currentView);
                      } else {
                        storage.clearContinueWatching();
                      }
                    }}
                    onClearWatchlist={() => {
                      if (currentView === 'vod' || currentView === 'series') {
                        storage.clearWatchlist(currentView);
                      } else {
                        storage.clearWatchlist();
                      }
                    }}
                  />
                </div>
              </>
            )}

            {/* Content Stage Grid */}
            <main className="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-[#0b0e14] to-slate-950">
              {/* Section Subheader / Breadcrumb */}
              <div className="min-h-12 flex-wrap gap-2 py-2 px-3 sm:px-6 border-b border-slate-850 flex items-center justify-between shrink-0 bg-slate-950/40">
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={handleNavigateHome}
                    className="text-slate-400 hover:text-white"
                  >
                    Home
                  </button>
                  <span className="text-slate-600">/</span>
                  <span className="font-bold text-white capitalize">
                    {headerSearchQuery.trim()
                      ? `Search: "${headerSearchQuery}"`
                      : currentView === 'continue_watching'
                      ? 'Continue Watching'
                      : currentView === 'vod'
                      ? 'Movies (VOD)'
                      : currentView}
                  </span>

                  {selectedCategoryId !== 'all' && !headerSearchQuery.trim() && (
                    <>
                      <span className="text-slate-600">/</span>
                      <span className="text-sky-400 font-semibold">
                        {selectedCategoryName}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* Clear Button above titles for Favorites, Watchlist, and Continue Watching / Watch Again */}
                  {(selectedCategoryId === 'special_favorites' ||
                    selectedCategoryId === 'special_continue' ||
                    selectedCategoryId === 'special_watchlist' ||
                    currentView === 'favorites' ||
                    currentView === 'continue_watching' ||
                    currentView === 'watchlist') &&
                    currentGridItems.length > 0 && (
                      <button
                        id="btn-clear-active-special"
                        onClick={() => {
                          if (
                            selectedCategoryId === 'special_favorites' ||
                            currentView === 'favorites'
                          ) {
                            storage.clearFavorites(
                              currentView !== 'favorites' ? currentView : undefined
                            );
                          } else if (
                            selectedCategoryId === 'special_continue' ||
                            currentView === 'continue_watching'
                          ) {
                            storage.clearContinueWatching(
                              currentView !== 'continue_watching' ? currentView : undefined
                            );
                          } else if (
                            selectedCategoryId === 'special_watchlist' ||
                            currentView === 'watchlist'
                          ) {
                            storage.clearWatchlist(
                              currentView !== 'watchlist' ? currentView : undefined
                            );
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-semibold tv-focus transition-all flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>
                          Clear{' '}
                          {selectedCategoryId === 'special_favorites' || currentView === 'favorites'
                            ? 'Favorites'
                            : selectedCategoryId === 'special_watchlist' || currentView === 'watchlist'
                            ? 'Watchlist'
                            : currentView === 'live'
                            ? 'Watch Again'
                            : 'History'}
                        </span>
                      </button>
                    )}

                  {refreshNotice && (
                    <span className="text-xs text-sky-400 font-medium flex items-center gap-1.5 animate-pulse">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      {refreshNotice}
                    </span>
                  )}
                  <span className="text-xs text-slate-400 font-mono">
                    {currentGridItems.length.toLocaleString()} Title{currentGridItems.length === 1 ? '' : 's'}
                    {currentGridItems.length > visibleCount && (
                      <span className="text-sky-400 font-semibold ml-1.5">
                        (Showing {displayedGridItems.length})
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Scrollable Grid of Content Cards */}
              <div
                id="main-scrollable-content-grid"
                onScroll={handleGridScroll}
                className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6"
              >
                {isLoadingContent ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 py-16">
                    <RefreshCw className="w-9 h-9 text-sky-400 animate-spin" />
                    <p className="text-sm font-semibold text-slate-200">{loadingStatusText}</p>
                    <p className="text-xs text-slate-400">Loading catalog from Xtream server...</p>
                  </div>
                ) : currentGridItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 text-center p-8">
                    {headerSearchQuery.trim() ? (
                      <>
                        <Search className="w-10 h-10 text-slate-400 mb-1" />
                        <h3 className="text-base font-semibold text-slate-200">
                          No titles found for "{headerSearchQuery}"
                        </h3>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Try searching for another keyword or clear the search field to view all content.
                        </p>
                      </>
                    ) : selectedCategoryId === 'special_favorites' || currentView === 'favorites' ? (
                      <>
                        <Star className="w-10 h-10 text-amber-400 mb-1" />
                        <h3 className="text-base font-semibold text-slate-200">
                          No Favorites in {currentView === 'live' ? 'Live TV' : currentView === 'vod' ? 'Movies' : 'Series'}
                        </h3>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Click the star icon on any {currentView === 'live' ? 'channel' : currentView === 'vod' ? 'movie' : 'series'} to quickly access it from this category.
                        </p>
                      </>
                    ) : selectedCategoryId === 'special_continue' || currentView === 'continue_watching' ? (
                      <>
                        <History className="w-10 h-10 text-emerald-400 mb-1" />
                        <h3 className="text-base font-semibold text-slate-200">
                          Nothing In Progress in {currentView === 'live' ? 'Live TV' : currentView === 'vod' ? 'Movies' : 'Series'}
                        </h3>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Titles you start watching will automatically appear here with exact resume timestamps.
                        </p>
                      </>
                    ) : selectedCategoryId === 'special_watchlist' || currentView === 'watchlist' ? (
                      <>
                        <Bookmark className="w-10 h-10 text-sky-400 mb-1" />
                        <h3 className="text-base font-semibold text-slate-200">Watchlist Empty</h3>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Save movies and series to watch later by clicking the bookmark icon.
                        </p>
                      </>
                    ) : (
                      <>
                        <Tv className="w-10 h-10 text-slate-400 mb-1" />
                        <h3 className="text-base font-semibold text-slate-200">No Items Found</h3>
                        <p className="text-xs text-slate-400 max-w-sm">
                          Try selecting another category or refresh your Xtream playlist.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <div
                      id="content-card-grid"
                      className={`content-card-grid grid gap-3 sm:gap-4 ${
                        currentView === 'live' && !headerSearchQuery.trim()
                          ? 'content-card-grid-live'
                          : 'content-card-grid-poster'
                      }`}
                    >
                      {displayedGridItems.map((item) => (
                        <StreamCard
                          key={`${item.type}-${item.id}`}
                          item={item}
                          progress={storage.getProgress(item.id)}
                          isFavorite={storage.isFavorite(item.id, item.type)}
                          isInWatchlist={storage.isInWatchlist(item.id, item.type)}
                          onSelect={handleSelectCard}
                          onToggleFavorite={storage.toggleFavorite}
                          onToggleWatchlist={storage.toggleWatchlist}
                          onPlayDirect={(itm) => handleStartPlay(itm, 0)}
                        />
                      ))}
                    </div>

                    {/* Pagination Load More trigger for large libraries */}
                    {visibleCount < currentGridItems.length && (
                      <div className="flex flex-col items-center justify-center pt-8 pb-4 gap-2">
                        <span className="text-xs text-slate-400 font-mono">
                          Showing {displayedGridItems.length} of {currentGridItems.length.toLocaleString()} titles
                        </span>
                        <button
                          id="btn-load-more-titles"
                          onClick={() => setVisibleCount((prev) => Math.min(prev + 48, currentGridItems.length))}
                          className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 tv-focus transition-all flex items-center gap-2 shadow-lg hover:border-sky-500/50"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                          <span>Load More Titles (+48)</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </main>
          </>
        )}
      </div>

      {/* 3. Details Screen Modal (For Movies & Series with synopsis, cast, resume button, and season episodes) */}
      {selectedDetailsItem && (
        <DetailsModal
          item={selectedDetailsItem}
          progress={storage.getProgress(selectedDetailsItem.id)}
          lastSeriesProgress={
            selectedDetailsItem.type === 'series'
              ? storage.getSeriesProgress(Number(selectedDetailsItem.id))
              : undefined
          }
          getEpisodeProgress={storage.getEpisodeProgress}
          isFavorite={storage.isFavorite(selectedDetailsItem.id, selectedDetailsItem.type)}
          isInWatchlist={storage.isInWatchlist(selectedDetailsItem.id, selectedDetailsItem.type)}
          onClose={() => setSelectedDetailsItem(null)}
          onPlay={handleStartPlay}
          onToggleFavorite={storage.toggleFavorite}
          onToggleWatchlist={storage.toggleWatchlist}
          onToggleEpisodeWatched={storage.toggleEpisodeWatched}
          isEpisodeWatched={storage.isEpisodeWatched}
          getSeasonProgress={storage.getSeasonProgress}
        />
      )}

      {/* 4. Video Player (Fullscreen HLS Adaptive Bitrate Player with 10s seeking and in-player episode switching) */}
      {activePlayer && (
        <VideoPlayer
          item={activePlayer.item}
          streamUrl={activePlayer.streamUrl}
          initialTime={activePlayer.initialTime}
          seriesContext={activePlayer.seriesContext}
          onClose={() => setActivePlayer(null)}
          onUpdateProgress={storage.updateProgress}
          getEpisodeProgress={storage.getEpisodeProgress}
          isEpisodeWatched={storage.isEpisodeWatched}
          onSelectEpisode={(ep, seasonNum) => {
            handleStartPlay(activePlayer.item, 0, {
              seriesId: activePlayer.seriesContext?.seriesId || Number(activePlayer.item.id),
              seasonNum,
              episode: ep,
            });
          }}
        />
      )}

      {/* 5. Xtream Server & Login Settings Modal */}
      <ServerLoginModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSuccess={() => {
          setCredentials(xtreamService.getCredentials());
          setUserInfo(xtreamService.getUserInfo());
          setServerInfo(xtreamService.getServerInfo());
          setIsDemo(xtreamService.getIsDemo());
          if (currentView !== 'home') {
            loadViewData(currentView as MainNavView, 'all');
          }
        }}
        currentCredentials={credentials}
        userInfo={userInfo}
        serverInfo={serverInfo}
        isDemo={isDemo}
        tvFontSize={storage.tvFontSize}
        onTvFontSizeChange={storage.setTvFontSize}
      />

      {/* 6. Magic Remote HUD Helper */}
      {showRemoteHud && (
        <RemoteControlHUD
          onBack={handleBackNavigation}
          onSearch={() => {
            const input = document.getElementById('header-search-input');
            input?.focus();
          }}
          isPlayerOpen={!!activePlayer}
        />
      )}

      {/* 7. PWA Offline Toast */}
      <OfflineIndicator />

      {/* 7. TV Exit Confirmation Dialog (when back is pressed at root) */}
      <ModalShell
        open={showExitConfirm}
        onClose={() => setShowExitConfirm(false)}
        overlayId="exit-confirm-modal"
        cardId="exit-confirm-card"
        ariaLabel="Exit application confirmation"
        overlayClassName="z-50 bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
        cardClassName="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-2xl space-y-5 text-center"
      >
        <div className="w-14 h-14 mx-auto rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shadow-lg shadow-red-500/10">
          <LogOut className="w-7 h-7" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xl font-bold text-white tracking-tight">Exit IPTV Player?</h3>
          <p className="text-sm text-slate-300">
            Are you sure you want to close and exit the application?
          </p>
          <p className="text-xs text-sky-400 font-mono pt-1">
            Press Back again or select Exit
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            id="btn-exit-cancel"
            autoFocus
            onClick={() => setShowExitConfirm(false)}
            className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold border border-slate-700 transition-all tv-focus"
          >
            Cancel [Stay]
          </button>

          <button
            id="btn-exit-confirm"
            onClick={handleExitApp}
            className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold shadow-lg shadow-red-600/25 transition-all tv-focus"
          >
            Exit Application
          </button>
        </div>
      </ModalShell>
    </div>
  );
}
