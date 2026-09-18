import React, { useState } from 'react';
import {
  Compass,
  CornerDownLeft,
  Search,
  RotateCcw,
  RotateCw,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

interface RemoteControlHUDProps {
  onBack: () => void;
  onSearch: () => void;
  isPlayerOpen: boolean;
  onPlayerSeek?: (offset: number) => void;
  onPlayerPlayPause?: () => void;
}

export const RemoteControlHUD: React.FC<RemoteControlHUDProps> = ({
  onBack,
  onSearch,
  isPlayerOpen,
  onPlayerSeek,
  onPlayerPlayPause,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      id="magic-remote-hud"
      className="fixed bottom-3 right-3 z-30 select-none flex flex-col items-end pointer-events-auto"
    >
      {/* Collapsible Panel */}
      {isOpen && (
        <div className="glass-chrome mb-2 p-3.5 rounded-2xl text-xs space-y-3 w-64">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-1.5 font-bold text-white">
              <Compass className="w-4 h-4 text-sky-400" />
              <span>webOS Magic Remote HUD</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono">
              LG TV
            </span>
          </div>

          <div className="space-y-1.5 text-slate-400 text-[11px]">
            <p className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" /> Red Button:</span>
              <span className="text-slate-200 font-semibold">Live TV</span>
            </p>
            <p className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Green Button:</span>
              <span className="text-slate-200 font-semibold">Movies</span>
            </p>
            <p className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> Yellow Button:</span>
              <span className="text-slate-200 font-semibold">Series</span>
            </p>
            <p className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-400" /> Blue Button:</span>
              <span className="text-slate-200 font-semibold">Search</span>
            </p>
            <p className="flex items-center justify-between pt-1 border-t border-slate-800/80">
              <span>Back Button:</span>
              <span className="text-slate-200 font-mono">Key 461 / ESC</span>
            </p>
          </div>

          {/* Simulated Remote Key Buttons for Testing */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Quick Remote Key Actions
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                id="hud-btn-back"
                onClick={onBack}
                className="glass-control tv-focus flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white text-xs"
              >
                <CornerDownLeft className="w-3.5 h-3.5 text-rose-400" />
                <span>Back [ESC]</span>
              </button>

              <button
                id="hud-btn-search"
                onClick={onSearch}
                className="glass-control tv-focus flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white text-xs"
              >
                <Search className="w-3.5 h-3.5 text-amber-400" />
                <span>Search [Y]</span>
              </button>

              {isPlayerOpen && (
                <>
                  <button
                    id="hud-btn-seek-left"
                    onClick={() => onPlayerSeek?.(-10)}
                    className="glass-control tv-focus flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                    <span>-10s</span>
                  </button>

                  <button
                    id="hud-btn-seek-right"
                    onClick={() => onPlayerSeek?.(10)}
                    className="glass-control tv-focus flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-200 hover:text-white text-xs"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-sky-400" />
                    <span>+10s</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trigger Toggle Button */}
      <button
        id="btn-toggle-magic-remote-hud"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-control tv-focus flex items-center gap-2 px-3 py-1.5 rounded-full text-slate-300 hover:text-white hover:border-sky-500 text-xs group"
      >
        <Compass className="w-3.5 h-3.5 text-sky-400" />
        <span className="font-semibold text-[11px]">Magic Remote Helper</span>
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </button>
    </div>
  );
};
