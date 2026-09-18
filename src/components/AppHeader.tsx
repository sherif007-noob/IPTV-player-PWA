import React, { useState, useRef, useEffect } from 'react';
import {
  Tv,
  Film,
  Clapperboard,
  Search,
  X,
  RefreshCw,
  Settings,
  Home,
  Star,
  History,
  Bookmark,
  Wifi,
  ChevronDown,
  Type,
  Check,
  Menu,
} from 'lucide-react';
import { MainNavView, TvFontSize } from '../types';
import { FONT_NAMES, FONT_SCALES } from '../hooks/useStorage';
import { PWAInstallButton } from './PWAInstallButton';

interface AppHeaderProps {
  currentView: MainNavView | 'home';
  onNavigateHome: () => void;
  onSelectView: (view: MainNavView) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  isDemo: boolean;
  selectedCategoryName?: string;
  tvFontSize?: TvFontSize;
  onSelectFontSize?: (size: TvFontSize) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isHidden?: boolean;
  onRequestReveal?: () => void;
}

const FONT_OPTIONS: { id: TvFontSize; label: string; previewClass: string }[] = [
  { id: 'small', label: 'Small (100% - Mobile)', previewClass: 'text-xs' },
  { id: 'medium', label: 'Medium (125%)', previewClass: 'text-sm' },
  { id: 'large', label: 'Large (150%)', previewClass: 'text-base' },
  { id: 'huge', label: 'Huge (180% - TV)', previewClass: 'text-lg font-bold' },
  { id: 'maximum', label: 'Maximum (210%)', previewClass: 'text-xl font-bold' },
];

export const AppHeaderComponent: React.FC<AppHeaderProps> = ({
  currentView,
  onNavigateHome,
  onSelectView,
  searchQuery,
  onSearchChange,
  onOpenSettings,
  onRefresh,
  isRefreshing,
  isDemo,
  selectedCategoryName,
  tvFontSize = 'huge',
  onSelectFontSize,
  isSidebarOpen = false,
  onToggleSidebar,
  isHidden = false,
  onRequestReveal,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
  const fontMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (fontMenuRef.current && !fontMenuRef.current.contains(e.target as Node)) {
        setIsFontMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const syncHeight = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty('--app-header-height', `${height}px`);
      }
    };

    syncHeight();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHeight) : null;
    observer?.observe(header);
    window.addEventListener('resize', syncHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncHeight);
    };
  }, []);

  const sections: { id: MainNavView; label: string; icon: any }[] = [
    { id: 'live', label: 'Live TV', icon: Tv },
    { id: 'vod', label: 'Movies', icon: Film },
    { id: 'series', label: 'Series', icon: Clapperboard },
  ];

  const searchPlaceholder =
    currentView === 'vod'
      ? 'Search movie titles...'
      : currentView === 'series'
      ? 'Search TV series titles...'
      : currentView === 'live'
      ? 'Search live channels...'
      : 'Search all library titles...';

  const currentScaleText = FONT_SCALES[tvFontSize] || '100%';

  return (
    <header
      ref={headerRef}
      id="app-top-header"
      aria-label="Primary navigation"
      data-hidden={isHidden ? 'true' : 'false'}
      onFocusCapture={() => onRequestReveal?.()}
      className={`app-header app-header-overlay glass-chrome h-16 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 z-20 shrink-0 select-none ${
        isHidden ? 'app-header-hidden' : ''
      }`}
    >
      {/* Brand & Home Navigation */}
      <div className="app-header-primary flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Hamburger Menu Button to Toggle Categories Sidebar */}
        <button
          id="btn-header-hamburger"
          data-skip-spatial="false"
          onClick={onToggleSidebar}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
          title={currentView === 'home'
            ? 'Browse Live TV categories'
            : isSidebarOpen
            ? 'Hide categories'
            : 'Show categories'}
          aria-label={currentView === 'home' ? 'Browse Live TV categories' : 'Toggle categories sidebar'}
          aria-controls="category-sidebar-wrapper"
          aria-expanded={currentView !== 'home' ? isSidebarOpen : false}
          className={`header-control header-icon-control-mobile flex items-center justify-center p-2 rounded-xl border tv-focus transition-all duration-200 ${
            isSidebarOpen && currentView !== 'home'
              ? 'bg-sky-500/20 text-sky-400 border-sky-400/50 shadow-sm shadow-sky-500/20'
              : 'bg-slate-900/70 backdrop-blur-md border-white/10 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-white/20'
          }`}
        >
          {isSidebarOpen && currentView !== 'home' ? (
            <X className="w-4 h-4 text-sky-400" />
          ) : (
            <Menu className="w-4 h-4 text-sky-400" />
          )}
        </button>

        <button
          id="btn-header-home"
          onClick={onNavigateHome}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
          title="Return to Home Dashboard"
          className={`header-control header-icon-control-mobile flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-xl border tv-focus transition-all duration-200 ${
            currentView === 'home'
              ? 'bg-sky-500 text-white border-sky-300 font-bold shadow-md shadow-sky-500/30'
              : 'bg-slate-900/70 backdrop-blur-md border-white/10 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-white/20'
          }`}
        >
          <Home className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold hidden sm:inline">Home</span>
        </button>


        <div className="app-header-mobile-title hidden min-w-0">
          <span className="block truncate text-sm font-bold text-white">
            {currentView === 'home'
              ? 'Home'
              : currentView === 'vod'
              ? 'Movies'
              : currentView === 'series'
              ? 'Series'
              : currentView === 'live'
              ? 'Live TV'
              : currentView === 'continue_watching'
              ? 'Continue'
              : currentView.charAt(0).toUpperCase() + currentView.slice(1)}
          </span>
          {selectedCategoryName && currentView !== 'home' && (
            <span className="block truncate text-[10px] text-sky-400">{selectedCategoryName}</span>
          )}
        </div>

        {/* Section Quick Switcher Chips */}
        <div className="app-header-tabs flex items-center gap-1 sm:gap-1.5 border-l border-white/10 pl-1.5 sm:pl-3">
          {sections.map((sec) => {
            const Icon = sec.icon;
            const isActive = currentView === sec.id;
            return (
              <button
                key={sec.id}
                id={`header-tab-${sec.id}`}
                aria-label={sec.label}
                onClick={() => onSelectView(sec.id)}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') e.currentTarget.focus({ preventScroll: true }); }}
                className={`header-control flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold tv-focus transition-all duration-200 ${
                  isActive
                    ? 'bg-sky-500 text-white border border-sky-300 font-bold shadow-md shadow-sky-500/30'
                    : 'bg-slate-900/60 backdrop-blur-md border border-white/10 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-white/20'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-sky-400'}`} />
                <span className="hidden sm:inline">{sec.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Prominent Searchbar directly in the Header */}
      <div className="app-header-search flex-1 max-w-md sm:max-w-lg relative">
        <div className="relative flex items-center w-full">
          <Search className="w-4 h-4 text-sky-400 absolute left-3 pointer-events-none" />
          <input
            ref={inputRef}
            id="header-search-input"
            aria-label="Search library"
            data-skip-spatial="true"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (searchQuery) onSearchChange('');
                else inputRef.current?.blur();
              }
            }}
            placeholder={searchPlaceholder}
            className="header-search-input glass-control w-full rounded-xl pl-9 pr-16 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:shadow-[0_0_15px_rgba(56,189,248,0.25)] font-medium transition-all duration-200"
          />

          <div className="absolute right-2.5 flex items-center gap-1.5">
            {searchQuery ? (
              <button
                id="btn-clear-header-search"
                data-skip-spatial="true"
                onClick={() => onSearchChange('')}
                className="p-1 rounded text-slate-400 hover:text-white"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-white/10">
                [BLUE]
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right Controls: Refresh, Font Size Dropdown, Settings, PWA Install, HW Decode Badge */}
      <div className="app-header-actions flex items-center gap-2 shrink-0">
        <PWAInstallButton variant="header" />

        {/* Refresh Content Button */}
        <button
          id="btn-header-refresh"
          data-skip-spatial="true"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh credentials & Xtream content"
          className="header-control flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-control hover:bg-slate-800/75 text-slate-300 hover:text-white text-xs font-semibold disabled:opacity-50 tv-focus transition-all duration-200"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-sky-400 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span className="hidden md:inline">
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </span>
        </button>

        {/* Font Size Dropdown Menu */}
        <div ref={fontMenuRef} className="relative">
          <button
            id="btn-header-font-size"
            data-skip-spatial="true"
            onClick={() => setIsFontMenuOpen(!isFontMenuOpen)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setIsFontMenuOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={isFontMenuOpen}
            aria-controls="font-size-dropdown-menu"
            title="TV Screen Font Scale & Readability"
            className="header-control flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-control hover:bg-slate-800/75 text-slate-200 text-xs font-semibold tv-focus transition-all duration-200"
          >
            <Type className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-xs font-medium text-sky-300 font-sans">
              {currentScaleText}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {isFontMenuOpen && (
            <div
              id="font-size-dropdown-menu"
              role="menu"
              className="glass-surface absolute right-0 mt-2 w-56 rounded-xl p-1.5 z-50 flex flex-col space-y-1"
            >
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                TV Screen UI Scale
              </div>
              {FONT_OPTIONS.map((opt) => {
                const isSelected = tvFontSize === opt.id;
                return (
                  <button
                    key={opt.id}
                    id={`btn-font-opt-${opt.id}`}
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={() => {
                      if (onSelectFontSize) {
                        onSelectFontSize(opt.id);
                      }
                      setIsFontMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between ${
                      isSelected
                        ? 'bg-sky-500 text-white font-bold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className={opt.previewClass}>{opt.label}</span>
                    {isSelected && <Check className="w-4 h-4 shrink-0 text-white" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Server & Settings Button */}
        <button
          id="btn-header-settings"
          data-skip-spatial="true"
          onClick={onOpenSettings}
          title="Configure Xtream Codes Server"
          className="header-control header-icon-control-mobile flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-control hover:bg-slate-800/75 text-slate-300 hover:text-white text-xs font-semibold tv-focus transition-all duration-200"
        >
          <Settings className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden md:inline">Settings</span>
        </button>

        {/* Hardware 4K Badge */}
        <div className="hidden xl:flex header-control glass-control items-center gap-1 text-[11px] text-slate-400 font-mono px-2.5 py-1 rounded-lg">
          <Wifi className="w-3 h-3 text-emerald-400" />
          <span>4K HW</span>
        </div>
      </div>
    </header>
  );
};

export const AppHeader = React.memo(AppHeaderComponent);
