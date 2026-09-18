import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      id="pwa-offline-indicator"
      className="offline-indicator glass-control fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border-amber-500/40 px-3.5 py-2 text-xs font-semibold text-white"
    >
      <WifiOff className="w-4 h-4 text-amber-200" />
      <span>Offline Mode — Cached data and UI available.</span>
    </div>
  );
};
