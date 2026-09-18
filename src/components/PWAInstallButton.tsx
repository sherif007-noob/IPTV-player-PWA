import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, CheckCircle2, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { ModalShell } from './ModalShell';

interface PWAInstallButtonProps {
  variant?: 'header' | 'settings' | 'banner';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  // If already installed or running standalone, hide the button
  if (isInstalled) {
    if (variant === 'settings') {
      return (
        <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium py-1">
          <CheckCircle2 className="w-4 h-4" />
          <span>App is installed as PWA</span>
        </div>
      );
    }
    return null;
  }

  const handleInstall = async () => {
    if (isInstallable) {
      const success = await install();
      if (success) {
        setInstallSuccess(true);
        setTimeout(() => setInstallSuccess(false), 4000);
      }
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const iosGuide = (
    <ModalShell
      open={showIOSGuide}
      onClose={() => setShowIOSGuide(false)}
      overlayId="ios-pwa-install-modal"
      cardId="ios-pwa-install-card"
      ariaLabel="Install on iPhone or iPad"
      overlayClassName="z-50 bg-black/80 backdrop-blur-md p-4"
      cardClassName="w-full max-w-sm bg-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-2xl space-y-4 text-left relative overflow-y-auto"
    >
      <button
        onClick={() => setShowIOSGuide(false)}
        aria-label="Close install instructions"
        className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-3 pb-2 pr-8 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
          <p className="text-xs text-slate-400">Add to your Home Screen</p>
        </div>
      </div>

      <div className="space-y-3 text-xs text-slate-300">
        <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-950/70 border border-white/5">
          <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 font-bold font-mono text-xs">1</div>
          <div>
            <p className="font-semibold text-white flex items-center gap-1.5">
              Tap the <Share className="w-3.5 h-3.5 text-sky-400 inline" /> Share button
            </p>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Found in Safari's bottom toolbar on iPhone or top toolbar on iPad.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-950/70 border border-white/5">
          <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 font-bold font-mono text-xs">2</div>
          <div>
            <p className="font-semibold text-white flex items-center gap-1.5">
              Tap <PlusSquare className="w-3.5 h-3.5 text-sky-400 inline" /> "Add to Home Screen"
            </p>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Scroll through the share sheet and choose Add to Home Screen.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-950/70 border border-white/5">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 font-bold font-mono text-xs">3</div>
          <div>
            <p className="font-semibold text-white">Tap "Add" in the top right</p>
            <p className="text-slate-400 text-[11px] mt-0.5">
              The IPTV Player will then launch from your Home Screen as a standalone app.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowIOSGuide(false)}
        className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold shadow-md shadow-sky-500/30 transition-colors"
      >
        Got It
      </button>
    </ModalShell>
  );

  // Header compact button
  if (variant === 'header') {
    if (!isInstallable && !isIOS) {
      return null;
    }

    return (
      <>
        <button
          id="btn-pwa-install-header"
          data-skip-spatial="true"
          onClick={handleInstall}
          title={isIOS ? 'Install PWA on iPhone/iPad' : 'Install PWA Application'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-md shadow-sky-500/25 tv-focus transition-all duration-200 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isIOS ? 'Install PWA' : 'Install App'}</span>
        </button>

        {iosGuide}
      </>
    );
  }

  // Settings variant
  return (
    <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-bold text-white">Progressive Web App (PWA)</span>
        </div>
        {isIOS && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
            iOS Safari
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Install this personal IPTV player directly on Windows, macOS, Linux, iPhone, iPad, or Android for full-screen playback and offline capabilities.
      </p>
      <button
        onClick={handleInstall}
        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold shadow-md shadow-sky-500/25 transition-all"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{isIOS ? 'Show iOS Install Instructions' : 'Install PWA to Device'}</span>
      </button>

      {iosGuide}
    </div>
  );
};
