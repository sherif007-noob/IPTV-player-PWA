import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Tv, Film, Clapperboard, Star, Clock } from 'lucide-react';
import { ContentItem, ContentType } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: ContentItem[];
  onSelectItem: (item: ContentItem) => void;
  activeContentType?: ContentType | 'all';
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  allItems,
  onSelectItem,
  activeContentType = 'all',
}) => {
  const [query, setQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | ContentType>(activeContentType);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedFilter(activeContentType);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen, activeContentType]);

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();

    return allItems.filter((item) => {
      const matchType = selectedFilter === 'all' || item.type === selectedFilter;
      const matchName = item.name.toLowerCase().includes(q);
      const matchGenre = item.genre ? item.genre.toLowerCase().includes(q) : false;
      return matchType && (matchName || matchGenre);
    });
  }, [allItems, query, selectedFilter]);

  if (!isOpen) return null;

  return (
    <div
      id="search-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-2xl flex flex-col items-center p-4 sm:p-8"
    >
      <div
        id="search-container-box"
        className="w-full max-w-4xl bg-slate-900/90 backdrop-blur-xl border border-white/15 rounded-3xl overflow-hidden flex flex-col max-h-[85vh] shadow-2xl shadow-black/80"
      >
        {/* Search Input Bar */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-3 bg-slate-950/70 backdrop-blur-md">
          <Search className="w-5 h-5 text-sky-400 shrink-0 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
          <input
            ref={inputRef}
            id="input-global-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channels, movies, series, or genres in real-time..."
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-400 text-base sm:text-lg focus:outline-none font-medium"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <button
            id="btn-close-search"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white border border-slate-700 tv-focus ml-2"
          >
            Close [ESC]
          </button>
        </div>

        {/* Filter Type Pills */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2 overflow-x-auto bg-slate-900">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-2">
            Filter:
          </span>
          {[
            { id: 'all', label: 'All Content' },
            { id: 'live', label: 'Live TV', icon: Tv },
            { id: 'vod', label: 'Movies', icon: Film },
            { id: 'series', label: 'Series', icon: Clapperboard },
          ].map((tab) => {
            const isActive = selectedFilter === tab.id;
            return (
              <button
                key={tab.id}
                id={`search-filter-${tab.id}`}
                onClick={() => setSelectedFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 tv-focus ${
                  isActive
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon && <tab.icon className="w-3.5 h-3.5" />}
                <span>{tab.label}</span>
              </button>
            );
          })}
          <span className="ml-auto text-xs text-slate-400 font-mono">
            {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {searchResults.map((item) => {
            const isLive = item.type === 'live';
            return (
              <div
                key={`${item.type}-${item.id}`}
                id={`search-result-item-${item.id}`}
                onClick={() => {
                  onSelectItem(item);
                  onClose();
                }}
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-sky-500 hover:bg-slate-900 cursor-pointer flex items-center justify-between gap-4 tv-focus group"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                    {item.icon ? (
                      <img
                        src={item.icon}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : isLive ? (
                      <Tv className="w-6 h-6 text-sky-400" />
                    ) : item.type === 'vod' ? (
                      <Film className="w-6 h-6 text-indigo-400" />
                    ) : (
                      <Clapperboard className="w-6 h-6 text-violet-400" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white group-hover:text-sky-400">
                        {item.name}
                      </span>
                      {item.is4k && (
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-mono">
                          4K
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {item.type === 'live' ? 'Live TV' : item.type === 'vod' ? 'Movie' : 'Series'}
                      </span>
                      {item.year && <span>{item.year}</span>}
                      {item.rating && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <Star className="w-3 h-3 fill-current" />
                          {item.rating}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-sky-400 font-semibold">
                  View / Play &rarr;
                </div>
              </div>
            );
          })}

          {query.trim() && searchResults.length === 0 && (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <p className="text-sm">No titles matched "{query}"</p>
              <p className="text-xs text-slate-400">
                Try searching for another keyword or change your filter.
              </p>
            </div>
          )}

          {!query.trim() && (
            <div className="py-12 text-center text-slate-400 space-y-1">
              <Search className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium">Type any channel, movie or series name</p>
              <p className="text-xs text-slate-400">Results filter instantly as you type</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
