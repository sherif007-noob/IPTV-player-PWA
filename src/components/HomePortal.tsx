import React from 'react';
import {
  Tv,
  Film,
  Clapperboard,
  History,
  Clock,
  Play,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { MainNavView, PlaybackProgress } from '../types';

interface HomePortalProps {
  onSelectSection: (section: MainNavView, initialCategoryId?: string) => void;
  liveCount: number;
  moviesCount: number;
  seriesCount: number;
  continueWatchingList?: PlaybackProgress[];
  onResumeRecent?: (progress: PlaybackProgress) => void;
  onClearContinueWatching?: () => void;
  onScrollPositionChange?: (scrollTop: number) => void;
}

export const HomePortal: React.FC<HomePortalProps> = ({
  onSelectSection,
  liveCount,
  moviesCount,
  seriesCount,
  continueWatchingList = [],
  onResumeRecent,
  onClearContinueWatching,
  onScrollPositionChange,
}) => {
  // Series episode progress is stored per episode, so collapse multiple
  // episode records into one visible Series identity for Home presentation.
  const uniqueRecentItems = Array.from(
    continueWatchingList.reduce((items, progress) => {
      const identity =
        progress.type === 'series'
          ? `series:${progress.seriesId || progress.id}`
          : `${progress.type}:${progress.id}`;
      if (!items.has(identity)) items.set(identity, progress);
      return items;
    }, new Map<string, PlaybackProgress>()).values()
  );
  const recentThree = uniqueRecentItems.slice(0, 3);

  return (
    <div
      id="home-portal-dashboard"
      onScroll={(event) => onScrollPositionChange?.(event.currentTarget.scrollTop)}
      className="home-portal header-underlay-scroll flex-1 overflow-y-auto p-6 sm:p-10 max-w-7xl mx-auto w-full flex flex-col justify-start space-y-8 select-none"
    >
      {/* Primary 3 Pillars: Live TV, Movies, and TV Series Cards */}
      <section>
        <div className="home-portal-primary grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Live TV Card */}
          <button
            id="card-portal-live"
            onClick={() => onSelectSection('live')}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
            className="home-portal-card interactive-card group relative rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-white/10 p-8 cursor-pointer tv-focus hover:border-sky-400 focus:border-sky-400 flex flex-col items-center justify-center text-center h-64 hover:bg-slate-800/80 shadow-xl hover:shadow-sky-500/20 w-full overflow-hidden"
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-36 h-36 bg-sky-500/20 rounded-full blur-2xl group-hover:bg-sky-500/35 transition-all duration-500 pointer-events-none" />

            <div className="relative w-20 h-20 rounded-3xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mb-5 ambient-icon-bloom group-focus:scale-110 shadow-lg shadow-sky-500/20">
              <Tv className="w-10 h-10 text-sky-400 drop-shadow-[0_0_12px_rgba(56,189,248,0.5)]" />
            </div>

            <h3 className="relative text-2xl sm:text-3xl font-black text-white group-hover:text-sky-300 group-focus:text-sky-300 tracking-tight mb-2 transition-colors">
              Live TV
            </h3>

            <div className="relative flex items-center gap-2 text-xs font-mono text-slate-300/80 bg-slate-950/50 px-3 py-1 rounded-full border border-white/5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
              <span>{liveCount > 0 ? `${liveCount.toLocaleString()} Channels` : 'Live Channels'}</span>
            </div>
          </button>

          {/* Movies Card */}
          <button
            id="card-portal-vod"
            onClick={() => onSelectSection('vod')}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
            className="home-portal-card interactive-card group relative rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-white/10 p-8 cursor-pointer tv-focus hover:border-indigo-400 focus:border-indigo-400 flex flex-col items-center justify-center text-center h-64 hover:bg-slate-800/80 shadow-xl hover:shadow-indigo-500/20 w-full overflow-hidden"
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-36 h-36 bg-indigo-500/20 rounded-full blur-2xl group-hover:bg-indigo-500/35 transition-all duration-500 pointer-events-none" />

            <div className="relative w-20 h-20 rounded-3xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mb-5 ambient-icon-bloom group-focus:scale-110 shadow-lg shadow-indigo-500/20">
              <Film className="w-10 h-10 text-indigo-400 drop-shadow-[0_0_12px_rgba(129,140,248,0.5)]" />
            </div>

            <h3 className="relative text-2xl sm:text-3xl font-black text-white group-hover:text-indigo-300 group-focus:text-indigo-300 tracking-tight mb-2 transition-colors">
              Movies
            </h3>

            <div className="relative flex items-center gap-2 text-xs font-mono text-slate-300/80 bg-slate-950/50 px-3 py-1 rounded-full border border-white/5">
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                4K UHD
              </span>
              <span>{moviesCount > 0 ? `${moviesCount.toLocaleString()} Movies` : 'Feature Films'}</span>
            </div>
          </button>

          {/* TV Series Card */}
          <button
            id="card-portal-series"
            onClick={() => onSelectSection('series')}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
            className="home-portal-card interactive-card group relative rounded-3xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-white/10 p-8 cursor-pointer tv-focus hover:border-violet-400 focus:border-violet-400 flex flex-col items-center justify-center text-center h-64 hover:bg-slate-800/80 shadow-xl hover:shadow-violet-500/20 w-full overflow-hidden"
          >
            {/* Ambient Background Glow */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-36 h-36 bg-violet-500/20 rounded-full blur-2xl group-hover:bg-violet-500/35 transition-all duration-500 pointer-events-none" />

            <div className="relative w-20 h-20 rounded-3xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center mb-5 ambient-icon-bloom group-focus:scale-110 shadow-lg shadow-violet-500/20">
              <Clapperboard className="w-10 h-10 text-violet-400 drop-shadow-[0_0_12px_rgba(167,139,250,0.5)]" />
            </div>

            <h3 className="relative text-2xl sm:text-3xl font-black text-white group-hover:text-violet-300 group-focus:text-violet-300 tracking-tight mb-2 transition-colors">
              TV Series
            </h3>

            <div className="relative flex items-center gap-2 text-xs font-mono text-slate-300/80 bg-slate-950/50 px-3 py-1 rounded-full border border-white/5">
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold border border-violet-500/30">
                Seasons
              </span>
              <span>{seriesCount > 0 ? `${seriesCount.toLocaleString()} Series` : 'Episodes'}</span>
            </div>
          </button>
        </div>
      </section>

      {/* Jump Back In Section: 3 Titles Side by Side */}
      <section className="home-portal-recent space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <span>Jump Back In</span>
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            </h2>
            {continueWatchingList.length > 0 && (
              <span className="text-xs text-sky-400/80 font-mono bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                {uniqueRecentItems.length} in progress
              </span>
            )}
          </div>

          {continueWatchingList.length > 0 && onClearContinueWatching && (
            <button
              id="btn-clear-portal-continue"
              onClick={(e) => {
                e.stopPropagation();
                onClearContinueWatching();
              }}
              className="glass-control flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-300 px-3 py-1.5 rounded-xl hover:border-rose-500/50 tv-focus transition-all duration-200 hover:bg-rose-500/10"
              title="Clear continue watching history"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {recentThree.length > 0 ? (
          <div className="home-portal-recent-grid grid grid-cols-1 md:grid-cols-3 gap-5">
            {recentThree.map((item, idx) => {
              const progressPercent =
                item.duration > 0
                  ? Math.min(100, Math.max(5, Math.round((item.timestamp / item.duration) * 100)))
                  : 50;

              const formatMinutes = (secs: number) => {
                const m = Math.floor(secs / 60);
                const s = Math.floor(secs % 60);
                return `${m}:${String(s).padStart(2, '0')}`;
              };

              return (
                <div
                  key={`${item.id}-${idx}`}
                  id={`card-jump-back-${idx}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Resume ${item.title}`}
                  onClick={() => onResumeRecent && onResumeRecent(item)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      onResumeRecent?.(item);
                    }
                  }}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                  className="home-recent-card interactive-card group relative rounded-2xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 border border-white/10 p-4.5 cursor-pointer tv-focus hover:border-sky-400 focus:border-sky-400 hover:bg-slate-800/80 flex flex-col justify-between overflow-hidden shadow-lg hover:shadow-sky-500/15"
                >
                  <div className="flex items-start gap-3.5">
                    {/* Poster / Thumbnail with Glass Overlay */}
                    <div className="w-16 h-20 rounded-xl bg-slate-800/80 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center shadow-md">
                      {item.poster ? (
                        <img
                          src={item.poster}
                          alt={item.title}
                          className="w-full h-full object-cover transition-transform duration-500"
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <History className="w-7 h-7 text-sky-400" />
                      )}
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                        <div className="w-7 h-7 rounded-full bg-sky-500/90 text-white flex items-center justify-center shadow-lg shadow-sky-500/40 group-hover:scale-115 transition-transform duration-300">
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          {item.type === 'vod' ? 'Movie' : item.type === 'series' ? 'Series' : 'Live'}
                        </span>
                        {item.timestamp > 0 && (
                          <span className="text-[10px] font-mono text-slate-300 bg-black/30 px-1.5 py-0.5 rounded border border-white/5">
                            {formatMinutes(item.timestamp)}
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-white group-hover:text-sky-300 truncate tracking-tight transition-colors">
                        {item.title}
                      </h4>

                      {item.subtitle ? (
                        <p className="text-xs text-sky-400/90 font-medium truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {item.type === 'live' ? 'Live Stream' : 'Playback in progress'}
                        </p>
                      )}

                      {/* Resume Button */}
                      <div className="mt-2.5">
                        <button
                          id={`btn-jump-back-resume-${idx}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onResumeRecent && onResumeRecent(item);
                          }}
                          className="home-recent-resume primary-action tv-focus flex items-center gap-1.5 px-3 py-1 rounded-lg text-white text-xs font-bold"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Resume</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Full-Width Glowing Progress Bar */}
                  {item.timestamp > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-800/80 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-surface p-8 rounded-3xl flex flex-col items-center justify-center text-center text-slate-400 space-y-2 shadow-inner">
            <History className="w-8 h-8 text-slate-600 mb-1" />
            <p className="text-xs font-medium text-slate-300">
              No recent playback history yet.
            </p>
            <p className="text-[11px] text-slate-500 max-w-sm">
              Select Live TV, Movies, or TV Series above to begin watching and pick up right where you left off.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
