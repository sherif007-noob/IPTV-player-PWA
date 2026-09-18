import { ModalShell } from './ModalShell';
import React, { useState } from 'react';
import {
  Server,
  Lock,
  User,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  Zap,
  X,
  PlayCircle,
  Type,
  Tv,
  Settings,
} from 'lucide-react';
import { XtreamCredentials, XtreamUserInfo, XtreamServerInfo, TvFontSize } from '../types';
import { xtreamService, DEFAULT_USER_CREDENTIALS } from '../services/xtream';
import { PWAInstallButton } from './PWAInstallButton';

interface ServerLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentCredentials: XtreamCredentials | null;
  userInfo: XtreamUserInfo | null;
  serverInfo: XtreamServerInfo | null;
  isDemo: boolean;
  tvFontSize?: TvFontSize;
  onTvFontSizeChange?: (size: TvFontSize) => void;
}

export const ServerLoginModal: React.FC<ServerLoginModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentCredentials,
  userInfo,
  serverInfo,
  isDemo,
  tvFontSize = 'huge',
  onTvFontSizeChange,
}) => {
  const [server, setServer] = useState(
    currentCredentials?.server && !currentCredentials.server.includes('your-provider.com')
      ? currentCredentials.server
      : DEFAULT_USER_CREDENTIALS.server
  );
  const [username, setUsername] = useState(
    currentCredentials?.username || DEFAULT_USER_CREDENTIALS.username
  );
  const [password, setPassword] = useState(
    currentCredentials?.password && currentCredentials.password !== '01008550042'
      ? currentCredentials.password
      : DEFAULT_USER_CREDENTIALS.password
  );
  const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
  const [proxyEnabled, setProxyEnabled] = useState(
    isFileProtocol ? false : (currentCredentials?.proxyEnabled ?? false)
  );
  const [autoRefreshHours, setAutoRefreshHours] = useState(
    currentCredentials?.autoRefreshHours || 12
  );
  const [userAgent, setUserAgent] = useState(currentCredentials?.userAgent || '');
  const [referer, setReferer] = useState(currentCredentials?.referer || '');
  const [origin, setOrigin] = useState(currentCredentials?.origin || '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [rememberMe, setRememberMe] = useState(
    currentCredentials?.rememberMe ?? true
  );

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessNotice(null);

    const cleanServer = server.trim();
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanServer) {
      setErrorMessage('Please enter your Xtream Codes server URL (e.g. http://provider-server.com:8080)');
      return;
    }
    if (!cleanUser || !cleanPass) {
      setErrorMessage('Username and Password are required.');
      return;
    }

    setIsLoading(true);

    try {
      const creds: XtreamCredentials = {
        server: cleanServer,
        username: cleanUser,
        password: cleanPass,
        proxyEnabled,
        autoRefreshHours,
        rememberMe,
        userAgent,
        referer,
        origin,
      };

      const result = await xtreamService.authenticate(creds);
      setSuccessNotice(
        `Connected successfully! Account: ${result.user_info.username} (Status: ${result.user_info.status || 'Active'})`
      );
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Authentication failed. Please verify server URL, username and password.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchToDemo = () => {
    xtreamService.enableDemoMode();
    onSuccess();
    onClose();
  };

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      overlayId="server-login-modal-overlay"
      cardId="server-login-card"
      ariaLabel="Server settings"
      overlayClassName="z-50 bg-black/80 backdrop-blur-2xl p-4"
      cardClassName="w-full max-w-xl max-h-[calc(100dvh-2rem)] bg-slate-900/90 backdrop-blur-xl border border-white/15 rounded-3xl overflow-hidden flex flex-col shadow-2xl shadow-black/80"
    >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-slate-950/70 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Server className="w-5 h-5 text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Xtream Code Server Settings
              </h3>
              <p className="text-xs text-slate-400">
                Configure provider credentials & automated refresh schedule
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Account Status Info */}
        <div className="px-6 py-3 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-300 gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isDemo ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            />
            <span className="font-semibold">
              Mode: {isDemo ? 'Demo Mode (Sample Streams)' : 'Live Xtream Server'}
            </span>
          </div>
          {userInfo && (
            <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
              <span>Status: {userInfo.status}</span>
              <span>Exp: {userInfo.exp_date}</span>
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleConnect} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successNotice && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Server URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-sky-400" /> Server URL & Port
            </label>
            <input
              id="input-xtream-server"
              type="text"
              required
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="http://iptv-provider.net:8080"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-sky-500 font-mono"
            />
            <p className="text-[11px] text-slate-400">
              Example: http://domain.com:8080 (without player_api.php)
            </p>
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-400" /> Username
              </label>
              <input
                id="input-xtream-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-sky-400" /> Password
              </label>
              <input
                id="input-xtream-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Automated Refresh Mechanism */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-semibold text-slate-200">
                  Automated Content & Credential Refresh
                </span>
              </div>
              <select
                id="select-auto-refresh"
                value={autoRefreshHours}
                onChange={(e) => setAutoRefreshHours(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-sky-500"
              >
                <option value={4}>Every 4 Hours</option>
                <option value={6}>Every 6 Hours</option>
                <option value={12}>Every 12 Hours</option>
                <option value={24}>Every 24 Hours</option>
                <option value={0}>Manual Only</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Periodically checks user credentials with Xtream API, syncs playlist updates, and keeps streams responsive.
            </p>
          </div>

          {/* CORS Proxy & Remember Toggles */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-300 pt-1">
            {isFileProtocol ? (
              <div className="flex items-center gap-2 text-emerald-400 bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-800/50">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px] font-medium">Direct Mode (WebOS Packaged App)</span>
              </div>
            ) : (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={proxyEnabled}
                  onChange={(e) => setProxyEnabled(e.target.checked)}
                  className="rounded border-slate-700 text-sky-500 focus:ring-0"
                />
                <span>Enable Server Proxy (Bypasses browser CORS & mixed content)</span>
              </label>
            )}

            
            {proxyEnabled && !isFileProtocol && (
              <div className="w-full mt-3 border border-slate-700/50 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700/80 text-xs text-slate-300 font-medium transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Settings className="w-3.5 h-3.5" />
                    Advanced Proxy Headers (Anti-Block)
                  </span>
                  <span className="text-[10px] text-slate-500">{showAdvanced ? 'Hide' : 'Show'}</span>
                </button>
                {showAdvanced && (
                  <div className="p-4 bg-slate-900/50 space-y-3 border-t border-slate-700/50">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-slate-400">User-Agent</label>
                      <input
                        type="text"
                        value={userAgent}
                        onChange={(e) => setUserAgent(e.target.value)}
                        placeholder="e.g. VLC/3.0.18 LibVLC/3.0.18"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 space-y-1.5">
                        <label className="text-[11px] font-medium text-slate-400">Referer</label>
                        <input
                          type="text"
                          value={referer}
                          onChange={(e) => setReferer(e.target.value)}
                          placeholder="e.g. http://player.com"
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                        />
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <label className="text-[11px] font-medium text-slate-400">Origin</label>
                        <input
                          type="text"
                          value={origin}
                          onChange={(e) => setOrigin(e.target.value)}
                          placeholder="e.g. http://player.com"
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      Use these to bypass strict provider blocks. Look for <span className="text-amber-500 font-mono">http-user-agent</span> or <span className="text-amber-500 font-mono">http-referrer</span> in your m3u config.
                    </p>
                  </div>
                )}
              </div>
            )}


            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-slate-700 text-sky-500 focus:ring-0"
              />
              <span>Remember Credentials</span>
            </label>
          </div>

          {/* TV Font Size & Readability (70" TV Optimization) */}
          <div className="pt-3 border-t border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Type className="w-4 h-4 text-sky-400" />
                <span>Screen Font Size & Scaling (70" TV Mode)</span>
              </label>
              <span className="text-[11px] font-mono text-sky-300 font-bold bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
                {tvFontSize === 'small' && '100% - Mobile / Standard'}
                {tvFontSize === 'medium' && '125% - Medium'}
                {tvFontSize === 'large' && '150% - Large'}
                {tvFontSize === 'huge' && '180% - TV'}
                {tvFontSize === 'maximum' && '210% - Maximum'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {([
                { id: 'small', label: '100%', title: 'Small', desc: 'Mobile / standard' },
                { id: 'medium', label: '125%', title: 'Medium', desc: 'Closer viewing' },
                { id: 'large', label: '150%', title: 'Large', desc: 'Large screens' },
                { id: 'huge', label: '180%', title: 'Huge', desc: 'TV viewing' },
                { id: 'maximum', label: '210%', title: 'Maximum', desc: 'Maximum readability' },
              ] as { id: TvFontSize; label: string; title: string; desc: string }[]).map((opt) => {
                const isSelected = tvFontSize === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    id={`btn-tv-font-${opt.id}`}
                    onClick={() => onTvFontSizeChange?.(opt.id)}
                    className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border tv-focus ${
                      isSelected
                        ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className={`text-sm font-bold ${isSelected ? 'text-sky-300' : 'text-slate-200'}`}>
                      {opt.label}
                    </span>
                    <span className="text-[11px] font-semibold">{opt.title}</span>
                    <span className="text-[9px] text-slate-400">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Instantly scales all text, channel labels, category menus, and movie guides for comfortable viewing from 10-15 feet away.
            </p>
          </div>

          {/* PWA Cross-Platform Install */}
          <PWAInstallButton variant="settings" />

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              id="btn-switch-demo"
              onClick={handleSwitchToDemo}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 tv-focus"
            >
              <PlayCircle className="w-4 h-4 text-amber-400" />
              <span>Use 4K Demo Mode</span>
            </button>

            <div className="w-full sm:w-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 tv-focus"
              >
                Cancel
              </button>

              <button
                type="submit"
                id="btn-submit-connect"
                disabled={isLoading}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold tv-focus disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    <span>Connect & Load</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
    </ModalShell>
  );
};
