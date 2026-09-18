import { xtreamService } from './services/xtream';
import type { SeriesDetails, VodDetails } from './types';

type Entry<T> = {
  expiresAt: number;
  value?: T | null;
  pending?: Promise<T | null>;
};

const TTL_MS = 5 * 60 * 1000;
const vodCache = new Map<string, Entry<VodDetails>>();
const seriesCache = new Map<string, Entry<SeriesDetails>>();

function providerKey() {
  const credentials = xtreamService.getCredentials();
  const server = credentials?.server?.replace(/\/+$/, '') || 'demo';
  const username = credentials?.username || 'anonymous';
  return `${server}::${username}`;
}

function guarded<T>(
  cache: Map<string, Entry<T>>,
  id: number,
  loader: () => Promise<T | null>
): Promise<T | null> {
  const now = Date.now();
  const key = `${providerKey()}::${id}`;
  const current = cache.get(key);

  if (current?.pending) return current.pending;
  if (current && current.expiresAt > now && 'value' in current) {
    return Promise.resolve(current.value ?? null);
  }

  const pending = loader()
    .then((value) => {
      // Cache successful detail payloads for a few minutes. Null/error fallbacks get a
      // short cooldown only so a temporary provider 429 does not become permanent.
      cache.set(key, {
        value,
        expiresAt: Date.now() + (value ? TTL_MS : 15_000),
      });
      return value;
    })
    .catch((error) => {
      cache.set(key, { value: null, expiresAt: Date.now() + 15_000 });
      throw error;
    });

  cache.set(key, { pending, expiresAt: now + 15_000 });
  return pending;
}

const originalVodDetails = xtreamService.getVodDetails.bind(xtreamService);
const originalSeriesDetails = xtreamService.getSeriesDetails.bind(xtreamService);

xtreamService.getVodDetails = (vodId: number) =>
  guarded(vodCache, vodId, () => originalVodDetails(vodId));

xtreamService.getSeriesDetails = (seriesId: number) =>
  guarded(seriesCache, seriesId, () => originalSeriesDetails(seriesId));
