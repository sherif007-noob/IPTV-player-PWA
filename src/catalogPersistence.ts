import { xtreamService } from './services/xtream';
import { readCatalog, writeCatalog, clearCatalogs } from './services/catalogStore';
import { VodMovie, SeriesItem } from './types';

const TTL_MS = 6 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<any[]>>();

const originalVod = xtreamService.getVodStreams.bind(xtreamService);
const originalSeries = xtreamService.getSeries.bind(xtreamService);

function providerKey() {
  const credentials = xtreamService.getCredentials();
  const server = credentials?.server?.replace(/\/+$/, '') || 'demo';
  const username = credentials?.username || 'anonymous';
  return `${server}::${username}`;
}

async function deduped<T>(
  key: string,
  request: () => Promise<T[]>,
  persist: (data: T[]) => Promise<void>
): Promise<T[]> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T[]>;

  const pending = request()
    .then(async (data) => {
      if (Array.isArray(data) && data.length) await persist(data);
      return data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}

async function readFromAll<T extends { category_id: string }>(
  kind: 'vod' | 'series',
  categoryId: string
): Promise<T[] | null> {
  if (categoryId === 'all') return null;
  const all = await readCatalog<T[]>(providerKey(), kind, 'all');
  if (!all?.data?.length) return null;
  return all.data.filter((item) => item.category_id === categoryId);
}

xtreamService.getVodStreams = async (categoryId: string = 'all'): Promise<VodMovie[]> => {
  const key = categoryId || 'all';
  const provider = providerKey();
  const exact = await readCatalog<VodMovie[]>(provider, 'vod', key);

  if (exact?.data?.length) {
    if (Date.now() - exact.updatedAt > TTL_MS) {
      void deduped(
        `${provider}:vod:${key}`,
        () => originalVod(key),
        (data) => writeCatalog(provider, 'vod', key, data)
      ).catch((error) => console.warn('Background VOD refresh notice:', error));
    }
    return exact.data;
  }

  const filtered = await readFromAll<VodMovie>('vod', key);
  if (filtered?.length) return filtered;

  return deduped(
    `${provider}:vod:${key}`,
    () => originalVod(key),
    (data) => writeCatalog(provider, 'vod', key, data)
  );
};

xtreamService.getSeries = async (categoryId: string = 'all'): Promise<SeriesItem[]> => {
  const key = categoryId || 'all';
  const provider = providerKey();
  const exact = await readCatalog<SeriesItem[]>(provider, 'series', key);

  if (exact?.data?.length) {
    if (Date.now() - exact.updatedAt > TTL_MS) {
      void deduped(
        `${provider}:series:${key}`,
        () => originalSeries(key),
        (data) => writeCatalog(provider, 'series', key, data)
      ).catch((error) => console.warn('Background Series refresh notice:', error));
    }
    return exact.data;
  }

  const filtered = await readFromAll<SeriesItem>('series', key);
  if (filtered?.length) return filtered;

  return deduped(
    `${provider}:series:${key}`,
    () => originalSeries(key),
    (data) => writeCatalog(provider, 'series', key, data)
  );
};

export async function invalidatePersistentCatalogs() {
  inFlight.clear();
  await clearCatalogs();
}
