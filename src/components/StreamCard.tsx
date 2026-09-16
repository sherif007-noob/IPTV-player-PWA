import React, { useState } from 'react';
import { Play, Star, Bookmark, Clock, Tv, Film, Clapperboard } from 'lucide-react';
import { ContentItem, PlaybackProgress } from '../types';

interface StreamCardProps {
  item: ContentItem;
  progress?: PlaybackProgress | null;
  isFavorite: boolean;
  isInWatchlist: boolean;
  onSelect: (item: ContentItem) => void;
  onToggleFavorite: (item: ContentItem) => void;
  onToggleWatchlist?: (item: ContentItem) => void;
  onPlayDirect?: (item: ContentItem) => void;
}

const StreamCardComponent: React.FC<StreamCardProps> = ({
  item,
  progress,
  isFavorite,
  isInWatchlist,
  onSelect,
  onToggleFavorite,
  onToggleWatchlist,
  onPlayDirect,
}) => {
  const [imageError, setImageError] = useState(false);

  const isLive = item.type === 'live';
  const progressPercent =
    progress && progress.duration > 0
      ? Math.min(100, Math.round((progress.timestamp / progress.duration) * 100))
      : 0;

  return (
    <div
      id={`stream-card-${item.type}-${item.id}`}
      tabIndex={0}
      role="button"
      onClick={() => onSelect(item)}
      onPointerEnter={(e) => (e.currentTarget as HTMLElement).focus({ preventScroll: true })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item);
        }
      }}
      className="group relative rounded-2xl bg-gradient-to-b from-slate-900/80 to-slate-950/80 backdrop-blur-md border border-white/10 overflow-hidden cursor-pointer tv-focus flex flex-col hover:border-sky-400 focus:border-sky-400 shadow-lg hover:shadow-sky-500/20 hover:-translate-y-1 transition-all duration-300"
    >
      {/* Media Thumbnail Container */}
      <div
        className={`relative w-full bg-slate-950 overflow-hidden ${
          isLive ? 'aspect-video' : 'aspect-[2/3]'
        }`}
      >
        {item.icon && !imageError ? (
          <img
            src={item.icon}
            alt={item.name}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-108 group-focus:scale-108 transition-transform duration-500"
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-slate-400 bg-slate-950">
            {isLive ? (
              <Tv className="w-8 h-8 text-sky-400 mb-2 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
            ) : item.type === 'vod' ? (
              <Film className="w-8 h-8 text-indigo-400 mb-2 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
            ) : (
              <Clapperboard className="w-8 h-8 text-violet-400 mb-2 drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]" />
            )}
            <span className="text-xs text-center font-medium line-clamp-2 px-2 text-slate-400">
              {item.name}
            </span>
          </div>
        )}

        {/* Hover / Focus Play Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-sky-500/90 text-white flex items-center justify-center shadow-lg shadow-sky-500/50 group-hover:scale-110 transition-transform duration-300">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </div>
        </div>

        {/* Top Badges (4K UHD, Live) */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 z-10">
          {item.is4k && (
            <span className="text-[10px] font-black tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-mono shadow-md">
              4K UHD
            </span>
          )}
          {isLive && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600/90 backdrop-blur-md text-white tracking-wide flex items-center gap-1 shadow-md shadow-rose-600/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          )}
        </div>

        {/* Action Buttons Overlay (Favorite, Watchlist) */}
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10 opacity-80 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">
          <button
            id={`btn-fav-${item.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(item);
            }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className={`p-1.5 rounded-xl backdrop-blur-md transition-all duration-200 ${
              isFavorite
                ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/40'
                : 'bg-slate-950/70 border border-white/10 text-slate-300 hover:text-amber-400 hover:bg-slate-900/90'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
          </button>

          {!isLive && onToggleWatchlist && (
            <button
              id={`btn-watch-${item.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatchlist(item);
              }}
              title={isInWatchlist ? 'In watchlist' : 'Add to watchlist'}
              className={`p-1.5 rounded-xl backdrop-blur-md transition-all duration-200 ${
                isInWatchlist
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/40'
                  : 'bg-slate-950/70 border border-white/10 text-slate-300 hover:text-sky-400 hover:bg-slate-900/90'
              }`}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isInWatchlist ? 'fill-current' : ''}`} />
            </button>
          )}
        </div>

        {/* Playback Progress Bar (Continue Watching) */}
        {progress && progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-800/80">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Card Metadata */}
      <div className="p-3 flex-1 flex flex-col justify-between">
        <div>
          <h4 className="text-xs font-semibold text-slate-200 line-clamp-1 group-hover:text-sky-300 transition-colors">
            {item.name}
          </h4>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
            {item.year && <span>{item.year}</span>}
            {item.rating && (
              <span className="flex items-center gap-1 text-amber-400 font-medium">
                <Star className="w-3 h-3 fill-current" />
                {typeof item.rating === 'number' ? item.rating.toFixed(1) : item.rating}
              </span>
            )}
            {item.container_extension && (
              <span className="uppercase text-[9px] px-1 py-0.5 rounded bg-slate-800/80 font-mono text-slate-300 border border-white/5">
                {item.container_extension}
              </span>
            )}
          </div>
        </div>

        {/* Resume indicator if available */}
        {progress && progress.timestamp > 0 && (
          <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center gap-1 text-[10px] text-sky-400 font-medium">
            <Clock className="w-3 h-3" />
            <span>
              Resume at {Math.floor(progress.timestamp / 60)}:
              {String(Math.floor(progress.timestamp % 60)).padStart(2, '0')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const StreamCard = React.memo(StreamCardComponent);
