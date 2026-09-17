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

function getStartOffset(src: string): number {
  try {
    const parsed = new URL(src, window.location.href);
    const start = Number(parsed.searchParams.get('start') || '0');
    return Number.isFinite(start) && start > 0 ? start : 0;
  } catch {
    return 0;
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

      // Xtream's VOD info endpoint also returns duration for movie streams. Series
      // episode duration may already come from the episode metadata, so failure here
      // is harmless and the native duration remains available as a fallback.
      const apiUrl = new URL(`${parsed.origin}/player_api.php`);
      apiUrl.searchParams.set('username', username);
      apiUrl.searchParams.set('password', password);
      apiUrl.searchParams.set('action', 'get_vod_info');
      apiUrl.searchParams.set('vod_id', mediaId);
      const response = await fetch(`/api/xtream/proxy?url=${encodeURIComponent(apiUrl.toString())}`, { cache: 'no-store' });
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

function performProgrammaticTranscodedSeek(video: HTMLVideoElement, targetSeconds: number): boolean {
  if (seekInProgress.has(video) || !Number.isFinite(targetSeconds) || targetSeconds < 0) return false;

  const currentSrc = video.currentSrc || video.src;
  let parsed: URL;
  try {
    parsed = new URL(currentSrc, window.location.href);
  } catch {
    return false;
  }
  if (!parsed.pathname.endsWith('/api/xtream/stream')) return false;

  const upstream = parsed.searchParams.get('url');
  if (!upstream) return false;
  try {
    if (!/\.mkv$/i.test(new URL(upstream).pathname)) return false;
  } catch {
    return false;
  }

  const target = Math.max(0, Math.floor(targetSeconds));
  const existingStart = Number(parsed.searchParams.get('start') || '0');
  if (Number.isFinite(existingStart) && Math.abs(existingStart - target) < 1) return true;

  if (target > 0) parsed.searchParams.set('start', String(target));
  else parsed.searchParams.delete('start');
  parsed.searchParams.delete('_r');
  parsed.searchParams.delete('_t');

  const nextUrl = parsed.toString();
  const wasPaused = video.paused;
  seekInProgress.add(video);
  console.log(`Programmatic transcoded seek: target=${target}s url=${nextUrl}`);

  const finish = () => {
    seekInProgress.delete(video);
    if (!wasPaused) {
      const p = video.play();
      if (p) p.catch(() => {});
    }
  };

  video.addEventListener('loadedmetadata', finish, { once: true });
  video.src = nextUrl;
  video.load();
  window.setTimeout(() => seekInProgress.delete(video), 15000);
  return true;
}

function installMediaPropertyBridges() {
  if (typeof HTMLVideoElement === 'undefined' || typeof HTMLMediaElement === 'undefined') return;

  const mediaProto = HTMLMediaElement.prototype;
  const durationDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'duration');
  const currentTimeDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'currentTime');
  if (!durationDescriptor?.get || !durationDescriptor.configurable || !currentTimeDescriptor?.get || !currentTimeDescriptor.set || !currentTimeDescriptor.configurable) {
    console.warn('Transcoded playback bridge could not be installed on this browser.');
    return;
  }

  const marker = '__xtreamPlaybackBridgeInstalled';
  if ((HTMLVideoElement.prototype as any)[marker]) return;
  Object.defineProperty(HTMLVideoElement.prototype, marker, { value: true });

  Object.defineProperty(HTMLVideoElement.prototype, 'duration', {
    configurable: true,
    enumerable: durationDescriptor.enumerable,
    get(this: HTMLVideoElement) {
      const upstream = getProxyUpstreamUrl(this.currentSrc || this.src);
      const known = upstream ? durationCache.get(upstream) : undefined;
      return known && known > 0 ? known : durationDescriptor.get!.call(this);
    },
  });

  Object.defineProperty(HTMLVideoElement.prototype, 'currentTime', {
    configurable: true,
    enumerable: currentTimeDescriptor.enumerable,
    get(this: HTMLVideoElement) {
      const raw = currentTimeDescriptor.get!.call(this);
      const start = getStartOffset(this.currentSrc || this.src);
      return start > 0 && Number.isFinite(raw) ? raw + start : raw;
    },
    set(this: HTMLVideoElement, value: number) {
      const src = this.currentSrc || this.src;
      const upstream = getProxyUpstreamUrl(src);
      if (!upstream || !Number.isFinite(value)) {
        currentTimeDescriptor.set!.call(this, value);
        return;
      }

      const start = getStartOffset(src);
      const rawNow = currentTimeDescriptor.get!.call(this);
      const absoluteNow = (Number.isFinite(rawNow) ? rawNow : 0) + start;

      // Tiny nudges are used by the stall watchdog and should stay inside the
      // currently open transcoded response. Real seeks/resume requests must restart
      // the proxy with an absolute start offset because the fMP4 response itself is
      // intentionally non-seekable.
      if (Math.abs(value - absoluteNow) < 1) {
        currentTimeDescriptor.set!.call(this, Math.max(0, value - start));
        return;
      }

      if (!performProgrammaticTranscodedSeek(this, value)) {
        currentTimeDescriptor.set!.call(this, Math.max(0, value - start));
      }
    },
  });

  (window as any).__xtreamCurrentTimeBridgeInstalled = true;
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

if (typeof window !== 'undefined') {
  installMediaPropertyBridges();
  installDurationLookup();
}
