import { ModalShell } from './ModalShell';
import React, { useState, useEffect } from 'react';
import {
  Play,
  RotateCcw,
  Star,
  Bookmark,
  Clock,
  Calendar,
  Layers,
  CheckCircle2,
  Circle,
  X,
  Sparkles,
  Tv,
  Film,
  ArrowLeft,
} from 'lucide-react';
import {
  ContentItem,
  VodDetails,
  SeriesDetails,
  Episode,
  PlaybackProgress,
} from '../types';
import { xtreamService } from '../services/xtream';

interface DetailsModalProps {
  item: ContentItem;
  progress: PlaybackProgress | null;
  lastSeriesProgress?: PlaybackProgress | null;
  isFavorite: boolean;
  isInWatchlist: boolean;
  onClose: () => void;
  onPlay: (
    item: ContentItem,
    startSeconds: number,
    seriesMeta?: { seriesId: number; seasonNum: number; episode: Episode; allEpisodes?: Episode[] }
  ) => void;
  onToggleFavorite: (item: ContentItem) => void;
  onToggleWatchlist: (item: ContentItem) => void;
  onToggleEpisodeWatched: (seriesId: number, seasonNum: number, episodeNum: number) => void;
  isEpisodeWatched: (seriesId: number, seasonNum: number, episodeNum: number) => boolean;
  getSeasonProgress: (
    seriesId: number,
    seasonNum: number,
    totalEpisodes: number
  ) => { watchedCount: number; total: number; percentage: number };
  getEpisodeProgress?: (
    seriesId: number,
    seasonNum: number,
    episodeNum: number,
    episodeId?: string | number
  ) => PlaybackProgress | null;
}

export const DetailsModal: React.FC<DetailsModalProps> = ({
  item,
  progress,
  lastSeriesProgress,
  isFavorite,
  isInWatchlist,
  onClose,
  onPlay,
  onToggleFavorite,
  onToggleWatchlist,
  onToggleEpisodeWatched,
  isEpisodeWatched,
  getSeasonProgress,
  getEpisodeProgress,
}) => {
  const [vodDetails, setVodDetails] = useState<VodDetails | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);

  const isMovie = item.type === 'vod';
  const isSeries = item.type === 'series';

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const loadDetails = async () => {
      try {
        if (isMovie) {
          const data = await xtreamService.getVodDetails(Number(item.id));
          if (isMounted) setVodDetails(data);
        } else if (isSeries) {
          const data = await xtreamService.getSeriesDetails(Number(item.id));
          if (isMounted) {
            setSeriesDetails(data);
            if (data?.seasons && data.seasons.length > 0) {
              // If there is active series progress, auto-select that season
              if (lastSeriesProgress && lastSeriesProgress.seasonNum) {
                setSelectedSeason(lastSeriesProgress.seasonNum);
              } else {
                setSelectedSeason(data.seasons[0].season_number);
              }
            }
          }
        }
      } catch (e) {
        console.error('Failed to load item details:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadDetails();
    return () => {
      isMounted = false;
    };
  }, [item, isMovie, isSeries, lastSeriesProgress]);

  // Auto-focus primary interactive button inside Details Modal when opened or loaded
  useEffect(() => {
    const timer = setTimeout(() => {
      const container = document.querySelector<HTMLElement>('#details-card-container');
      if (!container) return;
      const target =
        container.querySelector<HTMLElement>('#btn-resume-series-progress') ||
        container.querySelector<HTMLElement>('#btn-play-series-next') ||
        container.querySelector<HTMLElement>('#btn-resume-playback') ||
        container.querySelector<HTMLElement>('#btn-play-beginning') ||
        container.querySelector<HTMLElement>('#btn-play-first-episode') ||
        container.querySelector<HTMLElement>('#btn-details-fav') ||
        container.querySelector<HTMLElement>('#btn-details-back');
      if (target) {
        target.focus({ preventScroll: true });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [loading, item.id]);

  const coverArt =
    (isMovie ? vodDetails?.info?.movie_image : seriesDetails?.info?.cover) ||
    item.icon ||
    '';

  const backdrop =
    (isMovie
      ? vodDetails?.info?.backdrop_path?.[0]
      : seriesDetails?.info?.backdrop_path?.[0]) || coverArt;

  const synopsis =
    (isMovie ? vodDetails?.info?.plot : seriesDetails?.info?.plot) ||
    item.plot ||
    'No synopsis available for this title.';

  const rawCast =
    (isMovie
      ? vodDetails?.info?.cast || (vodDetails?.info as any)?.actors
      : seriesDetails?.info?.cast ||
        (seriesDetails?.info as any)?.actors ||
        (seriesDetails as any)?.series_info?.cast) ||
    item.cast ||
    '';

  const castList = typeof rawCast === 'string' && rawCast.trim()
    ? rawCast.split(/[,/]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const director =
    (isMovie ? vodDetails?.info?.director : seriesDetails?.info?.director) ||
    item.director ||
    'Unknown';

  const durationStr = vodDetails?.info?.duration || item.year;
  const ratingVal =
    vodDetails?.info?.rating || seriesDetails?.info?.rating || item.rating;

  const seasonsList = seriesDetails?.seasons || [
    { season_number: 1, name: 'Season 1', episode_count: 1 },
  ];

  const currentEpisodes: Episode[] =
    seriesDetails?.episodes?.[String(selectedSeason)] || [];

  const seasonProgress = isSeries
    ? getSeasonProgress(Number(item.id), selectedSeason, currentEpisodes.length)
    : null;

  const selectSeason = (seasonNumber: number) => {
    setSelectedSeason(seasonNumber);
    window.requestAnimationFrame(() => {
      document.getElementById('episodes-scrollable-grid')?.scrollTo({ top: 0, behavior: 'smooth' });
      document.getElementById(`tab-season-${seasonNumber}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    });
  };

  return (
    <ModalShell
      onClose={onClose}
      overlayId="details-modal-overlay"
      cardId="details-card-container"
      ariaLabel="Title details"
      overlayClassName="z-40 bg-black/80 backdrop-blur-2xl p-2 sm:p-4"
      cardClassName={`details-modal-card relative w-full max-w-5xl bg-slate-900/90 backdrop-blur-2xl border border-white/15 rounded-3xl overflow-hidden z-10 flex flex-col shadow-2xl shadow-black/80 ${
        isSeries ? 'details-series h-[92dvh] max-h-full' : 'details-movie max-h-full overflow-y-auto my-auto'
      }`}
    >
        {/* Top Action Bar (Back Button) */}
        <div className="details-back-action absolute top-3 right-3 z-30 flex items-center gap-2">
          <button
            id="btn-details-back"
            onClick={onClose}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 text-slate-300 hover:text-white hover:border-sky-400 tv-focus shadow-lg transition-all"
          >
            <ArrowLeft className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-medium">Back [ESC]</span>
          </button>
        </div>

        {/* Hero Section with Backdrop & Cover Art */}
        {isSeries ? (
          /* ULTRA-COMPACT UPPER SECTION FOR TV SERIES (leaves full screen for episodes) */
          <div className="details-series-hero relative shrink-0 p-3 sm:p-4 bg-slate-900 border-b border-slate-800 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="details-series-summary flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              {/* Compact Cover Art */}
              <div className="w-16 sm:w-20 aspect-[2/3] shrink-0 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 relative shadow-md">
                {coverArt ? (
                  <img
                    src={coverArt}
                    alt={item.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <Tv className="w-8 h-8" />
                  </div>
                )}
              </div>

              {/* Compact Title, Metadata, Synopsis, and Director/Cast */}
              <div className="details-series-info flex-1 min-w-0 pr-20 sm:pr-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                    TV Series
                  </span>
                  {ratingVal && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-400 border border-amber-400/30">
                      <Star className="w-3 h-3 fill-current" />
                      {typeof ratingVal === 'number' ? ratingVal.toFixed(1) : ratingVal}
                    </span>
                  )}
                  {durationStr && (
                    <span className="text-[11px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800">
                      {durationStr}
                    </span>
                  )}
                  {item.is4k && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-slate-950">
                      4K UHD
                    </span>
                  )}
                </div>

                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                  {item.name}
                </h1>

                {/* 1-Line Compact Synopsis */}
                <p className="text-xs text-slate-300 line-clamp-1 leading-snug mt-0.5">
                  {synopsis}
                </p>

                {/* Compact Cast & Director on 1 row */}
                <div className="mt-1 text-[11px] text-slate-400 truncate flex items-center gap-2">
                  <span>
                    <strong className="text-slate-300">Director:</strong> {director}
                  </span>
                  {castList.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="truncate">
                        <strong className="text-slate-300">Cast:</strong> {castList.slice(0, 4).join(', ')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Action Buttons for Series */}
            <div className="details-series-actions flex flex-wrap items-center gap-2 shrink-0 pt-1 sm:pt-0">
              {/* Resume Last Episode */}
              {lastSeriesProgress && lastSeriesProgress.timestamp > 5 ? (
                <button
                  id="btn-resume-series-progress"
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                  onClick={() => {
                    const targetSeason = lastSeriesProgress.seasonNum || selectedSeason || 1;
                    const targetEpNum = lastSeriesProgress.episodeNum || 1;
                    const seasonEps = seriesDetails?.episodes?.[String(targetSeason)] || currentEpisodes;
                    const foundEp = seasonEps.find((e) => e.episode_num === targetEpNum) || {
                      id: lastSeriesProgress.episodeId || `${item.id}_${targetSeason}_${targetEpNum}`,
                      episode_num: targetEpNum,
                      title: lastSeriesProgress.subtitle || `Episode ${targetEpNum}`,
                      container_extension: 'mp4',
                      season: targetSeason,
                    };

                    onPlay(item, lastSeriesProgress.timestamp, {
                      seriesId: Number(item.id),
                      seasonNum: targetSeason,
                      episode: foundEp,
                      allEpisodes: seasonEps,
                    });
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tv-focus shadow-md transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>
                    Resume S{lastSeriesProgress.seasonNum || 1} E{lastSeriesProgress.episodeNum || 1} (
                    {Math.floor(lastSeriesProgress.timestamp / 60)}:
                    {String(Math.floor(lastSeriesProgress.timestamp % 60)).padStart(2, '0')})
                  </span>
                </button>
              ) : (
                currentEpisodes.length > 0 && (
                  <button
                    id="btn-play-series-next"
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                    onClick={() => {
                      const firstEp = currentEpisodes[0];
                      onPlay(item, 0, {
                        seriesId: Number(item.id),
                        seasonNum: selectedSeason,
                        episode: firstEp,
                        allEpisodes: currentEpisodes,
                      });
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 text-white font-bold text-xs hover:bg-sky-400 tv-focus shadow-md transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play S{selectedSeason} E1</span>
                  </button>
                )
              )}

              {/* Add to Favorites */}
              <button
                id="btn-details-fav"
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                onClick={() => onToggleFavorite(item)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold tv-focus transition-all ${
                  isFavorite
                    ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 font-bold'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current text-amber-400' : ''}`} />
                <span>{isFavorite ? 'Favorite' : 'Fav'}</span>
              </button>

              {/* Add to Watchlist */}
              <button
                id="btn-details-watchlist"
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                onClick={() => onToggleWatchlist(item)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold tv-focus transition-all ${
                  isInWatchlist
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
                }`}
              >
                <Bookmark className={`w-3.5 h-3.5 ${isInWatchlist ? 'fill-current text-sky-400' : ''}`} />
                <span>{isInWatchlist ? 'Saved' : 'Watchlist'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* STANDARD FULL HERO SECTION FOR MOVIES (VOD) */
          <div className="details-movie-hero relative p-6 sm:p-8 flex flex-col md:flex-row gap-6 border-b border-slate-800">
            <div className="details-movie-cover w-44 sm:w-56 shrink-0 aspect-[2/3] rounded-xl overflow-hidden border border-slate-700 bg-slate-950 relative mx-auto md:mx-0">
              {coverArt ? (
                <img
                  src={coverArt}
                  alt={item.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400">
                  <Film className="w-12 h-12" />
                </div>
              )}
              {item.is4k && (
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-amber-500 font-black text-slate-950 text-[10px] font-mono tracking-wider">
                  4K ULTRA HD
                </div>
              )}
            </div>

            <div className="details-movie-body flex-1 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                    Movie (VOD)
                  </span>
                  {item.is4k && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-amber-500/30">
                      HDR10 / 4K
                    </span>
                  )}
                  {ratingVal && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-amber-400/20 text-amber-400 border border-amber-400/30">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      {typeof ratingVal === 'number' ? ratingVal.toFixed(1) : ratingVal} / 10
                    </span>
                  )}
                  {durationStr && (
                    <span className="flex items-center gap-1 text-xs text-slate-400 px-2 py-0.5 rounded bg-slate-800">
                      <Clock className="w-3.5 h-3.5" />
                      {durationStr}
                    </span>
                  )}
                </div>

                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  {item.name}
                </h1>

                <div className="mt-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Synopsis
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed line-clamp-4">
                    {synopsis}
                  </p>
                </div>

                <div className="mt-4 space-y-2 pt-3 border-t border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400 font-semibold">Director: </span>
                    <span className="text-slate-200 font-medium">{director}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold block mb-1.5">Cast Members:</span>
                    {castList.length > 0 ? (
                      <div className="details-cast-list flex flex-wrap gap-1.5 pr-1">
                        {castList.map((actor, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-100 border border-slate-700 text-xs font-medium"
                          >
                            {actor}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500 italic">No cast information available</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="details-movie-actions flex flex-wrap items-center gap-3 pt-4">
                {progress && progress.timestamp > 5 && (
                  <button
                    id="btn-resume-playback"
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                    onClick={() => {
                      const resolvedExt =
                        vodDetails?.movie_data?.container_extension ||
                        item.container_extension ||
                        'mkv';
                      onPlay(
                        { ...item, container_extension: resolvedExt },
                        progress.timestamp
                      );
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm tv-focus shadow-lg transition-all"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>
                      Resume at {Math.floor(progress.timestamp / 60)}:
                      {String(Math.floor(progress.timestamp % 60)).padStart(2, '0')}
                    </span>
                  </button>
                )}

                <button
                  id="btn-play-beginning"
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                  onClick={() => {
                    const resolvedExt =
                      vodDetails?.movie_data?.container_extension ||
                      item.container_extension ||
                      'mkv';
                    onPlay({ ...item, container_extension: resolvedExt }, 0);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 text-white font-bold text-sm hover:bg-sky-400 tv-focus shadow-lg transition-all"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {progress && progress.timestamp > 5
                      ? 'Play from Beginning'
                      : 'Play Movie Now'}
                  </span>
                </button>

                <button
                  id="btn-details-fav"
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                  onClick={() => onToggleFavorite(item)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold tv-focus transition-all ${
                    isFavorite
                      ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 font-bold'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  <Star className={`w-4 h-4 ${isFavorite ? 'fill-current text-amber-400' : ''}`} />
                  <span>{isFavorite ? 'In Favorites' : 'Add to Favorites'}</span>
                </button>

                <button
                  id="btn-details-watchlist"
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                  onClick={() => onToggleWatchlist(item)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold tv-focus transition-all ${
                    isInWatchlist
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  <Bookmark className={`w-4 h-4 ${isInWatchlist ? 'fill-current text-sky-400' : ''}`} />
                  <span>{isInWatchlist ? 'Saved in Watchlist' : 'Watchlist'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Series Section: Season Tabs & Episode Progress Tracker (ONLY SCROLLABLE AREA) */}
        {isSeries && (
          <div className="details-series-body p-3 sm:p-4 bg-slate-950 flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
            <div className="details-season-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2 shrink-0">
              {/* Season Selection Tabs */}
              <div className="details-season-tabs flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Seasons">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-sky-400" />
                  Seasons:
                </span>
                {seasonsList.map((season) => {
                  const sNum = season.season_number;
                  const isActive = selectedSeason === sNum;
                  return (
                    <button
                      key={sNum}
                      id={`tab-season-${sNum}`}
                      role="tab"
                      onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                      onClick={() => selectSeason(sNum)}
                      aria-selected={isActive}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold tv-focus transition-all ${
                        isActive
                          ? 'bg-sky-500 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                      }`}
                    >
                      {season.name || `Season ${sNum}`}
                    </button>
                  );
                })}
              </div>

              {/* Season Watched Progress Bar */}
              {seasonProgress && (
                <div className="details-season-progress flex items-center gap-2.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-300 font-medium">
                    Watched {seasonProgress.watchedCount} / {seasonProgress.total} episodes
                  </span>
                  <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${seasonProgress.percentage}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-emerald-400 font-mono">
                    {seasonProgress.percentage}%
                  </span>
                </div>
              )}
            </div>

            {/* Episode Cards Grid - PURE SINGLE SCROLLABLE REGION */}
            <div
              id="episodes-scrollable-grid"
              className="details-episode-grid flex-1 min-h-0 overflow-y-auto overflow-x-hidden grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pr-2 content-start pb-4"
            >
              {currentEpisodes.map((episode) => {
                const watched = isEpisodeWatched(
                  Number(item.id),
                  selectedSeason,
                  episode.episode_num
                );

                const epProgress = getEpisodeProgress
                  ? getEpisodeProgress(Number(item.id), selectedSeason, episode.episode_num, episode.id)
                  : null;

                const epPercent = watched
                  ? 100
                  : epProgress && epProgress.duration > 0
                  ? Math.min(100, Math.round((epProgress.timestamp / epProgress.duration) * 100))
                  : 0;

                const playThisEpisode = () => {
                  onPlay(item, epProgress?.timestamp || 0, {
                    seriesId: Number(item.id),
                    seasonNum: selectedSeason,
                    episode,
                    allEpisodes: currentEpisodes,
                  });
                };

                return (
                  <div
                    key={episode.id}
                    id={`episode-card-${episode.id}`}
                    tabIndex={0}
                    role="button"
                    onClick={playThisEpisode}
                    onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        playThisEpisode();
                      }
                    }}
                    className={`details-episode-card relative p-3 sm:p-3.5 rounded-xl border flex flex-col justify-between cursor-pointer min-h-[96px] sm:min-h-[104px] shrink-0 tv-focus transition-all group overflow-hidden ${
                      watched
                        ? 'bg-slate-900/60 border-slate-800 opacity-85 hover:border-emerald-500'
                        : 'bg-slate-900 border-slate-800 hover:border-sky-500 hover:bg-slate-850'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2.5 flex-1 min-w-0">
                      {/* Episode Number Box on the Left */}
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-slate-800 border border-slate-700/80 flex flex-col items-center justify-center shrink-0 shadow-inner group-hover:border-sky-500/60 group-hover:bg-slate-800 transition-colors">
                        <span className="text-[8px] sm:text-[9px] uppercase font-bold text-slate-400 font-sans tracking-wider leading-none">
                          EP
                        </span>
                        <span className="text-xs sm:text-sm font-extrabold text-sky-400 font-mono leading-none mt-0.5">
                          {episode.episode_num}
                        </span>
                      </div>

                      {/* Episode info */}
                      <div className="flex-1 min-w-0 pr-1">
                        <h4 className="text-xs sm:text-sm font-semibold text-slate-100 group-hover:text-sky-300 truncate">
                          {episode.title?.trim() || `Episode ${episode.episode_num}`}
                        </h4>

                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {episode.info?.duration && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {episode.info.duration}
                            </span>
                          )}
                          {epPercent > 0 && !watched && (
                            <span className="text-[9px] sm:text-[10px] font-mono text-sky-400 font-semibold bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/60">
                              {epPercent}% watched
                            </span>
                          )}
                          {watched && (
                            <span className="text-[9px] sm:text-[10px] font-mono text-emerald-400 font-semibold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/60 flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Watched
                            </span>
                          )}
                        </div>

                        {episode.info?.plot && (
                          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-1 line-clamp-1 leading-snug">
                            {episode.info.plot}
                          </p>
                        )}
                      </div>

                      {/* Actions: Play episode & Toggle Watched */}
                      <div className="details-episode-actions flex flex-col items-end justify-between gap-1.5 shrink-0 self-center">
                        <div
                          id={`btn-play-ep-${episode.id}`}
                          className="p-1.5 rounded-lg bg-sky-500 text-white group-hover:bg-sky-400 shadow-md transition-colors"
                          title="Play episode"
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </div>

                        <button
                          id={`btn-toggle-watched-ep-${episode.id}`}
                          tabIndex={-1}
                          data-skip-spatial="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleEpisodeWatched(
                              Number(item.id),
                              selectedSeason,
                              episode.episode_num
                            );
                          }}
                          className="details-watched-toggle flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-400 p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                          title={watched ? 'Mark as unwatched' : 'Mark as watched'}
                        >
                          {watched ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
                          ) : (
                            <Circle className="w-3.5 h-3.5" />
                          )}
                          <span className="hidden sm:inline">
                            {watched ? 'Watched' : 'Mark'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Full-Width Bottom Progress Bar */}
                    {epPercent > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800/80 overflow-hidden rounded-b-xl">
                        <div
                          className={`h-full transition-all duration-300 ${
                            watched
                              ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                              : 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.6)]'
                          }`}
                          style={{ width: `${epPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {currentEpisodes.length === 0 && (
                <div className="col-span-full py-12 text-center text-xs text-slate-400">
                  No episodes found for this season.
                </div>
              )}
            </div>
          </div>
        )}
    </ModalShell>
  );
};
