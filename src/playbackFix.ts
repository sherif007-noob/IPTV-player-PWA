const durationCache = new Map<string, number>();
const durationPromises = new Map<string, Promise<number | null>>();

function getProxyUpstreamUrl(src: string): string | null {
  try {
    const parsed = new URL(src, window.location.href);
    if (!parsed.pathname.endsWith('/api/xtream/stream')) return null;
    const upstream = parsed.searchParams.get('url');
    if (!upstream) return null;
    const upstreamUrl = new URL(upstream);
    return /\.mkv$/i.test(upstreamUrl.pathname) ? upstreamUrl.toString() : null;
  } catch {
    return null;
  }
}

function getDurationFromXtreamUrl(upstreamUrl: string): Promise<number | null> {
  const cached = durationCache.get(upstreamUrl);
  if (cached && cached > 0) return Promise.resolve(cached);

  const existing = durationPromises.get(upstreamUrl);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const parsed = new URL(upstreamUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length < 4) return null;

      const section = parts[0].toLowerCase();
      if (section !== 'movie' && section !== 'series') return null;

      const username = parts[1];
      const password = parts[2];
      const mediaId = parts[3].replace(/\.[^.]+$/, '');
      if (!username || !password || !mediaId) return null;

      const apiUrl = new URL(`${parsed.origin}/player_api.php`);
      apiUrl.searchParams.set('username', username);
      apiUrl.searchParams.set('password', password);
      apiUrl.searchParams.set('action', 'get_vod_info');
      apiUrl.searchParams.set('vod_id', mediaId);

      const response = await fetch(
        `/api/xtream/proxy?url=${encodeURIComponent(apiUrl.toString())}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return null;

      const data = await response.json();
      const raw = data?.info?.duration_secs ?? data?.info?.duration_sec ?? data?.info?.duration;
      const seconds = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) return null;

      durationCache.set(upstreamUrl, seconds);
      return seconds;
    } catch (error) {
      console.warn('VOD duration lookup failed:', error);
      return null;
    } finally {
      durationPromises.delete(upstreamUrl);
    }
  })();

  durationPromises.set(upstreamUrl, promise);
  return promise;
}

function resetLegacyCurrentTimeBridge() {
  if (typeof HTMLVideoElement === 'undefined') return;

  // Older builds installed configurable currentTime/duration properties directly on
  // HTMLVideoElement.prototype. Remove them so currentTime is once again the native
  // HTMLMediaElement value. Seeking is now owned exclusively by VideoPlayer state.
  try {
    if (Object.prototype.hasOwnProperty.call(HTMLVideoElement.prototype, 'currentTime')) {
      delete (HTMLVideoElement.prototype as any).currentTime;
    }
  } catch {}
  try {
    if (Object.prototype.hasOwnProperty.call(HTMLVideoElement.prototype, 'duration')) {
      delete (HTMLVideoElement.prototype as any).duration;
    }
  } catch {}
  try {
    delete (HTMLVideoElement.prototype as any).__xtreamPlaybackBridgeInstalled;
  } catch {}
  try {
    delete (window as any).__xtreamCurrentTimeBridgeInstalled;
  } catch {}
}

function installDurationBridge() {
  if (typeof HTMLVideoElement === 'undefined' || typeof HTMLMediaElement === 'undefined') return;

  const nativeDuration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
  if (!nativeDuration?.get || !nativeDuration.configurable) return;

  Object.defineProperty(HTMLVideoElement.prototype, 'duration', {
    configurable: true,
    enumerable: nativeDuration.enumerable,
    get(this: HTMLVideoElement) {
      const upstream = getProxyUpstreamUrl(this.currentSrc || this.src);
      const known = upstream ? durationCache.get(upstream) : undefined;
      return known && known > 0 ? known : nativeDuration.get!.call(this);
    },
  });
}

function installDurationLookup() {
  document.addEventListener(
    'loadedmetadata',
    (event) => {
      const video = event.target as HTMLVideoElement | null;
      if (!(video instanceof HTMLVideoElement)) return;

      const upstream = getProxyUpstreamUrl(video.currentSrc || video.src);
      if (!upstream) return;

      void getDurationFromXtreamUrl(upstream).then((seconds) => {
        if (!seconds) return;
        durationCache.set(upstream, seconds);
        video.dispatchEvent(new Event('durationchange'));
      });
    },
    true
  );
}

if (typeof window !== 'undefined') {
  resetLegacyCurrentTimeBridge();
  installDurationBridge();
  installDurationLookup();
}
