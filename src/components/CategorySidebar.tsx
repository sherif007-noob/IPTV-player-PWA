import React, { useState, useMemo } from 'react';
import {
  Layers,
  Search,
  Folder,
  Check,
  Star,
  History,
  Bookmark,
} from 'lucide-react';
import { XtreamCategory } from '../types';

interface CategorySidebarProps {
  title: string;
  categories: XtreamCategory[];
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
  categoryCounts?: Record<string, number>;
  favoritesCount?: number;
  continueCount?: number;
  watchlistCount?: number;
  onClearFavorites?: () => void;
  onClearContinue?: () => void;
  onClearWatchlist?: () => void;
}

const CategorySidebarComponent: React.FC<CategorySidebarProps> = ({
  title,
  categories,
  selectedCategoryId,
  onSelectCategory,
  categoryCounts = {},
  favoritesCount = 0,
  continueCount = 0,
  watchlistCount = 0,
  onClearFavorites,
  onClearContinue,
  onClearWatchlist,
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  const isLiveTV = title.toLowerCase().includes('live');
  const continueWatchingLabel = isLiveTV ? 'Watch Again' : 'Continue Watching';

  const filteredCategories = useMemo(() => {
    if (!filterQuery.trim()) return categories;
    const q = filterQuery.toLowerCase();
    return categories.filter((c) => c.category_name.toLowerCase().includes(q));
  }, [categories, filterQuery]);

  const allCount = categoryCounts['all'] ?? 0;

  return (
    <div
      id="category-sidebar-panel"
      className="w-64 bg-slate-950/80 backdrop-blur-xl border-r border-white/10 flex flex-col shrink-0 select-none shadow-xl"
    >
      {/* Category Header */}
      <div className="p-3.5 border-b border-white/10 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              {title} Categories
            </h3>
          </div>
          <span className="text-[11px] font-mono text-sky-300 px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/25">
            {categories.length}
          </span>
        </div>

        {/* Quick Filter Input for Genres */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="input-filter-categories"
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter categories..."
            className="w-full bg-slate-900/70 backdrop-blur-md border border-white/10 rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:shadow-[0_0_12px_rgba(56,189,248,0.25)] transition-all duration-200"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {/* Pinned Special Categories: All, Favorites, Continue Watching / Watch Again, Watchlist */}
        <div className="space-y-1 pb-2.5 border-b border-white/10 mb-2">
          {/* 1. All Content */}
          <button
            id="category-item-all"
            onClick={() => onSelectCategory('all')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between tv-focus transition-all duration-200 ${
              selectedCategoryId === 'all'
                ? 'bg-sky-500 text-white font-bold shadow-md shadow-sky-500/30'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-2 truncate pr-1">
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">All {title}</span>
            </div>
            {allCount > 0 && (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  selectedCategoryId === 'all'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 border border-white/5'
                }`}
              >
                {allCount}
              </span>
            )}
          </button>

          {/* 2. Favorites */}
          <button
            id="category-item-favorites"
            onClick={() => onSelectCategory('special_favorites')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between tv-focus transition-all duration-200 ${
              selectedCategoryId === 'special_favorites'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/30'
                : 'text-amber-300/90 hover:text-amber-200 hover:bg-amber-500/10'
            }`}
          >
            <div className="flex items-center gap-2 truncate pr-1">
              <Star className="w-3.5 h-3.5 fill-current shrink-0" />
              <span className="truncate">Favorites</span>
            </div>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                selectedCategoryId === 'special_favorites'
                  ? 'bg-amber-600 text-slate-950 font-bold'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
            >
              {favoritesCount}
            </span>
          </button>

          {/* 3. Continue Watching (or Watch Again for Live TV) */}
          <button
            id="category-item-continue"
            onClick={() => onSelectCategory('special_continue')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between tv-focus transition-all duration-200 ${
              selectedCategoryId === 'special_continue'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/30'
                : 'text-emerald-300/90 hover:text-emerald-200 hover:bg-emerald-500/10'
            }`}
          >
            <div className="flex items-center gap-2 truncate pr-1">
              <History className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{continueWatchingLabel}</span>
            </div>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                selectedCategoryId === 'special_continue'
                  ? 'bg-emerald-600 text-slate-950 font-bold'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {continueCount}
            </span>
          </button>

          {/* 4. Watchlist (for Movies and Series) */}
          <button
            id="category-item-watchlist"
            onClick={() => onSelectCategory('special_watchlist')}
            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between tv-focus transition-all duration-200 ${
              selectedCategoryId === 'special_watchlist'
                ? 'bg-indigo-500 text-white font-bold shadow-md shadow-indigo-500/30'
                : 'text-indigo-300/90 hover:text-indigo-200 hover:bg-indigo-500/10'
            }`}
          >
            <div className="flex items-center gap-2 truncate pr-1">
              <Bookmark className="w-3.5 h-3.5 fill-current shrink-0" />
              <span className="truncate">Watchlist</span>
            </div>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                selectedCategoryId === 'special_watchlist'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'bg-indigo-500/15 text-indigo-300'
              }`}
            >
              {watchlistCount}
            </span>
          </button>
        </div>

        {/* Server Genre / Groups Header */}
        <div className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Server Categories
        </div>

        {/* Xtream Categories List */}
        {filteredCategories.map((category) => {
          const isSelected = selectedCategoryId === category.category_id;
          const count = categoryCounts[category.category_id];

          return (
            <button
              key={category.category_id}
              id={`category-item-${category.category_id}`}
              onClick={() => onSelectCategory(category.category_id)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between tv-focus ${
                isSelected
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center gap-2 truncate pr-1">
                <Folder
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected ? 'text-sky-400' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{category.category_name}</span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {typeof count === 'number' && (
                  <span className="text-[10px] text-slate-400 font-mono px-1 rounded bg-slate-800">
                    {count}
                  </span>
                )}
                {isSelected && <Check className="w-3 h-3 text-sky-400 shrink-0" />}
              </div>
            </button>
          );
        })}

        {filteredCategories.length === 0 && (
          <div className="p-4 text-center text-xs text-slate-400">
            No categories match "{filterQuery}"
          </div>
        )}
      </div>
    </div>
  );
};

export const CategorySidebar = React.memo(CategorySidebarComponent);
