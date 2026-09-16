const durationCache = new Map<string, number>();
const durationPromises = new Map<string, Promise<number | null>>();
const seekInProgress = new WeakSet<HTMLVideoElement>();
const seekTimers = new WeakMap<HTMLVideoElement, number>();
let userSeekUntil = 0;

function getProxyUpstreamUrl(src: string): string | null {
  try {
    const parsed = new URL(src, window.location.href);
    if (!parsed.pathname.endsWith('/api/xtream/stream')) return null;
    const upstream = parsed.searchParams.get('url');
    if (!upstream) return null;
    const upstreamUrl = new URL(upstream);
    return /\.(mkv)$/i.test(upstreamUrl.pathname) ? upstreamUrl.toString() : null;
  } catch { return null; }
}

function getStartOffset(src: string): number {
  try {
    const parsed = new URL(src, window.location.href);
    const start = Number(parsed.searchParams.get('start') || '0');
    return Number.isFinite(start) && start > 0 ? start : 0;
  } catch { return 0; }
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
      const vodId = parts[3].replace(/\.[^.]+$/, '');
      if (!username || !password || !vodId) return null;
      const apiUrl = new URL(`${parsed.origin}/player_api.php`);
      apiUrl.searchParams.set('username', username);
      apiUrl.searchParams.set('password', password);
      apiUrl.searchParams.set('action', 'get_vod_info');
      apiUrl.searchParams.set('vod_id', vodId);
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

function installMediaPropertyBridges() {
  if (typeof HTMLVideoElement === 'undefined') return;
  const mediaProto = HTMLMediaElement.prototype;
  const durationDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'duration');
  const currentTimeDescriptor = Object.getOwnPropertyDescriptor(mediaProto, 'currentTime');
  if (!durationDescriptor?.get || !durationDescriptor.configurable || !currentTimeDescriptor?.get || !currentTimeDescriptor.set || !currentTimeDescriptor.configurable) return;
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
      const start = getStartOffset(this.currentSrc || this.src);
      currentTimeDescriptor.set!.call(this, start > 0 ? Math.max(0, value - start) : value);
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

function installUserSeekDetection() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input[type="range"]')) userSeekUntil = Date.now() + 5000;
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'MediaRewind' || event.key === 'MediaFastForward') {
      userSeekUntil = Date.now() + 3000;
    }
  }, true);
}

function performTranscodedSeek(video: HTMLVideoElement, target: number) {
  if (seekInProgress.has(video)) return;
  if (!Number.isFinite(target) || target < 0.5) return;
  const currentSrc = video.currentSrc || video.src;
  let parsed: URL;
  try { parsed = new URL(currentSrc, window.location.href); } catch { return; }
  if (!parsed.pathname.endsWith('/api/xtream/stream')) return;
  const upstream = parsed.searchParams.get('url');
  if (!upstream || !/\.mkv$/i.test(new URL(upstream).pathname)) return;
  const existingStart = Number(parsed.searchParams.get('start') || '0');
  if (Number.isFinite(existingStart) && Math.abs(existingStart - target) < 1.5) return;

  seekInProgress.add(video);
  parsed.searchParams.set('start', String(Math.floor(target)));
  console.log(`Transcoded MKV seek: target=${Math.floor(target)}s url=${parsed.toString()}`);
  const wasPaused = video.paused;
  video.src = parsed.toString();
  video.load();

  const playAfterLoad = () => {
    if (!wasPaused) {
      const p = video.play();
      if (p) p.catch(() => {});
    }
  };
  video.addEventListener('loadedmetadata', playAfterLoad, { once: true });
  window.setTimeout(() => seekInProgress.delete(video), 10000);
}

function installTranscodedSeeking() {
  document.addEventListener('seeking', (event) => {
    const video = event.target as HTMLVideoElement | null;
    if (!(video instanceof HTMLVideoElement) || seekInProgress.has(video) || Date.now() > userSeekUntil) return;
    const upstream = getProxyUpstreamUrl(video.currentSrc || video.src);
    if (!upstream) return;
    const target = Number(video.currentTime);
    if (!Number.isFinite(target) || target < 0.5) return;
    const previous = seekTimers.get(video);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      seekTimers.delete(video);
      performTranscodedSeek(video, Number(video.currentTime));
    }, 100);
    seekTimers.set(video, timer);
  }, true);

  // React/native sliders can update currentTime without producing a reliable
  // user-input signal before the native seeking event. Capture the range input
  // itself and schedule the source switch from its value.
  document.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.type !== 'range' || Date.now() > userSeekUntil) return;
    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (!video) return;
    const upstream = getProxyUpstreamUrl(video.currentSrc || video.src);
    if (!upstream) return;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;
    const previous = seekTimers.get(video);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      seekTimers.delete(video);
      performTranscodedSeek(video, value);
    }, 150);
    seekTimers.set(video, timer);
  }, true);
}

if (typeof window !== 'undefined') {
  installMediaPropertyBridges();
  installDurationLookup();
  installUserSeekDetection();
  installTranscodedSeeking();
}
