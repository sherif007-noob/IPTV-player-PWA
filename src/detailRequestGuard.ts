import { xtreamService } from './services/xtream';
import type { SeriesDetails, VodDetails } from './types';

type Entry<T> = {
  expiresAt: number;
  value?: T | null;
  pending?: Promise<T | null>;
};

const TTL_MS = 5 * 60 * 1000;
const vodCache = new Map<number, Entry<VodDetails>>();
const seriesCache = new Map<number, Entry<SeriesDetails>>();

function guarded<T>(
  cache: Map<number, Entry<T>>,
  id: number,
  loader: () => Promise<T | null>
): Promise<T | null> {
  const now = Date.now();
  const current = cache.get(id);

  if (current?.pending) return current.pending;
  if (current && current.expiresAt > now && 'value' in current) {
    return Promise.resolve(current.value ?? null);
  }

  const pending = loader()
    .then((value) => {
      // Cache successful detail payloads for a few minutes. Null/error fallbacks get a
      // short cooldown only so a temporary provider 429 does not become permanent.
      cache.set(id, {
        value,
        expiresAt: Date.now() + (value ? TTL_MS : 15_000),
      });
      return value;
    })
    .catch((error) => {
      cache.set(id, { value: null, expiresAt: Date.now() + 15_000 });
      throw error;
    });

  cache.set(id, { pending, expiresAt: now + 15_000 });
  return pending;
}

const originalVodDetails = xtreamService.getVodDetails.bind(xtreamService);
const originalSeriesDetails = xtreamService.getSeriesDetails.bind(xtreamService);

xtreamService.getVodDetails = (vodId: number) =>
  guarded(vodCache, vodId, () => originalVodDetails(vodId));

xtreamService.getSeriesDetails = (seriesId: number) =>
  guarded(seriesCache, seriesId, () => originalSeriesDetails(seriesId));
