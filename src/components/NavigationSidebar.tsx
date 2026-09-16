import React from 'react';
import {
  Tv,
  Film,
  Clapperboard,
  Star,
  Bookmark,
  History,
  Search,
  Settings,
  RefreshCw,
  Server,
  Zap,
} from 'lucide-react';
import { MainNavView, XtreamUserInfo } from '../types';

interface NavigationSidebarProps {
  currentView: MainNavView;
  onSelectView: (view: MainNavView) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  isDemo: boolean;
  userInfo: XtreamUserInfo | null;
  favoritesCount: number;
  watchlistCount: number;
  continueCount: number;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  currentView,
  onSelectView,
  onOpenSearch,
  onOpenSettings,
  onManualRefresh,
  isRefreshing,
  isDemo,
  userInfo,
  favoritesCount,
  watchlistCount,
  continueCount,
}) => {
  const navItems = [
    { id: 'live', label: 'Live TV', icon: Tv },
    { id: 'vod', label: 'Movies', icon: Film },
    { id: 'series', label: 'Series', icon: Clapperboard },
    { id: 'favorites', label: 'Favorites', icon: Star, badge: favoritesCount },
    { id: 'continue_watching', label: 'Continue', icon: History, badge: continueCount },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, badge: watchlistCount },
  ];

  return (
    <aside
      id="main-nav-sidebar"
      className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between p-4 select-none shrink-0 z-20"
    >
      {/* Brand & Platform Header */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 px-2 pt-1">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
            <Tv className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base tracking-tight text-white">webOS Player</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                4K HDR
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" /> Xtream Code Engine
            </p>
          </div>
        </div>

        {/* Search Quick Action */}
        <button
          id="btn-open-search"
          onClick={onOpenSearch}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 hover:bg-slate-850 tv-focus group"
        >
          <Search className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-medium">Search Library...</span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            [YELLOW]
          </span>
        </button>

        {/* Primary Navigation Menu */}
        <nav className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 px-3 pb-1">
            Browse Content
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                id={`nav-btn-${item.id}`}
                onClick={() => onSelectView(item.id as MainNavView)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium tv-focus ${
                  isActive
                    ? 'bg-sky-500 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-sky-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Server Connection Info & Automated Refresh Controls */}
      <div className="pt-4 border-t border-slate-850 space-y-3">
        {/* Account Info Pill */}
        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isDemo ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span className="text-xs font-semibold text-slate-200 truncate max-w-[110px]">
                {userInfo?.username || (isDemo ? 'Demo Mode' : 'Connected')}
              </span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-800 text-slate-400">
              {isDemo ? 'DEMO' : 'ACTIVE'}
            </span>
          </div>

          <p className="text-[11px] text-slate-400 truncate">
            Exp: {userInfo?.exp_date || 'No Expiry'}
          </p>

          <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between">
            <button
              id="btn-manual-refresh"
              onClick={onManualRefresh}
              disabled={isRefreshing}
              title="Automated or manual refresh of categories and playlist"
              className="flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-white"
            >
              <RefreshCw
                className={`w-3 h-3 text-sky-400 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh Content'}</span>
            </button>
          </div>
        </div>

        {/* Server & Settings Button */}
        <button
          id="btn-open-settings"
          onClick={onOpenSettings}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium border tv-focus ${
            currentView === 'settings'
              ? 'bg-indigo-600 text-white border-indigo-500'
              : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
          }`}
        >
          <Settings className="w-3.5 h-3.5 text-slate-400" />
          <span>Xtream Server & Settings</span>
        </button>
      </div>
    </aside>
  );
};
