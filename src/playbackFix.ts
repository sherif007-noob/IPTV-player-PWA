const durationCache = new Map<string, number>();
const durationPromises = new Map<string, Promise<number | null>>();
const seekInProgress = new WeakSet<HTMLVideoElement>();

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
      const filename = parts[3];
      const vodId = filename.replace(/\.[^.]+$/, '');
      if (!username || !password || !vodId) return null;

      const apiUrl = new URL(`${parsed.origin}/player_api.php`);
      apiUrl.searchParams.set('username', username);
      apiUrl.searchParams.set('password', password);
      apiUrl.searchParams.set('action', 'get_vod_info');
      apiUrl.searchParams.set('vod_id', vodId);

      const proxyUrl = `/api/xtream/proxy?url=${encodeURIComponent(apiUrl.toString())}`;
      const response = await fetch(proxyUrl, { cache: 'no-store' });
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

function installDurationBridge() {
  if (typeof HTMLVideoElement === 'undefined') return;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
  if (!descriptor?.get || !descriptor.configurable) return;

  const marker = '__xtreamStableDurationInstalled';
  if ((HTMLVideoElement.prototype as any)[marker]) return;
  Object.defineProperty(HTMLVideoElement.prototype, marker, { value: true });

  Object.defineProperty(HTMLVideoElement.prototype, 'duration', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get(this: HTMLVideoElement) {
      const upstream = getProxyUpstreamUrl(this.currentSrc || this.src);
      if (upstream) {
        const known = durationCache.get(upstream);
        if (known && known > 0) return known;
      }
      return descriptor.get!.call(this);
    },
  });
}

function installDurationLookup() {
  document.addEventListener('loadedmetadata', (event) => {
    const video = event.target as HTMLVideoElement | null;
    if (!(video instanceof HTMLVideoElement)) return;
    const upstream = getProxyUpstreamUrl(video.currentSrc || video.src);
    if (!upstream) return;

    void getDurationFromXtreamUrl(upstream).then((seconds) => {
      if (!seconds) return;
      durationCache.set(upstream, seconds);
      video.dispatchEvent(new Event('durationchange'));
      video.dispatchEvent(new Event('timeupdate'));
    });
  }, true);
}

function installTranscodedSeeking() {
  document.addEventListener('seeking', (event) => {
    const video = event.target as HTMLVideoElement | null;
    if (!(video instanceof HTMLVideoElement) || seekInProgress.has(video)) return;

    const upstream = getProxyUpstreamUrl(video.currentSrc || video.src);
    if (!upstream) return;

    const target = Number(video.currentTime);
    if (!Number.isFinite(target) || target < 0.5) return;

    const currentSrc = video.currentSrc || video.src;
    let parsed: URL;
    try {
      parsed = new URL(currentSrc, window.location.href);
    } catch {
      return;
    }

    const existingStart = Number(parsed.searchParams.get('start') || '0');
    if (Number.isFinite(existingStart) && Math.abs(existingStart - target) < 1.5) return;

    seekInProgress.add(video);
    try {
      parsed.searchParams.set('start', String(Math.floor(target)));
      const wasPaused = video.paused;
      video.src = parsed.toString();
      video.load();
      const playAfterLoad = () => {
        video.removeEventListener('loadedmetadata', playAfterLoad);
        if (!wasPaused) {
          const p = video.play();
          if (p) p.catch(() => {});
        }
      };
      video.addEventListener('loadedmetadata', playAfterLoad, { once: true });
    } finally {
      window.setTimeout(() => seekInProgress.delete(video), 1500);
    }
  }, true);
}

if (typeof window !== 'undefined') {
  installDurationBridge();
  installDurationLookup();
  installTranscodedSeeking();
}
