import fs from 'fs';
let text = fs.readFileSync('src/components/ServerLoginModal.tsx', 'utf8');

text = text.replace(
  'const [rememberMe, setRememberMe] = useState(',
  `const [userAgent, setUserAgent] = useState(currentCredentials?.userAgent || '');
  const [referer, setReferer] = useState(currentCredentials?.referer || '');
  const [origin, setOrigin] = useState(currentCredentials?.origin || '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [rememberMe, setRememberMe] = useState(`
);

text = text.replace(
  'autoRefreshHours,\n        rememberMe,\n      };',
  `autoRefreshHours,
        rememberMe,
        userAgent,
        referer,
        origin,
      };`
);

text = text.replace(
  '<label className="flex items-center gap-2 cursor-pointer">\n              <input\n                type="checkbox"\n                checked={rememberMe}',
  `<label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}`
);

const advancedSection = `
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
`;

text = text.replace(
  '<label className="flex items-center gap-2 cursor-pointer">\n              <input\n                type="checkbox"\n                checked={rememberMe}',
  advancedSection + '\n\n            <label className="flex items-center gap-2 cursor-pointer">\n              <input\n                type="checkbox"\n                checked={rememberMe}'
);

text = text.replace('Server, RefreshCw, X, AlertTriangle, Eye, EyeOff } from', 'Server, RefreshCw, X, AlertTriangle, Eye, EyeOff, Settings } from');

fs.writeFileSync('src/components/ServerLoginModal.tsx', text);
