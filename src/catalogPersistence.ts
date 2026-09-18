import { xtreamService } from './services/xtream';
import { readCatalog, writeCatalog, clearCatalogs } from './services/catalogStore';
import { VodMovie, SeriesItem } from './types';

const TTL_MS = 6 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<any[]>>();
const hotCatalogs = new Map<string, { updatedAt: number; data: any[] }>();

function hotKey(provider: string, kind: 'vod' | 'series', categoryId: string) {
  return `${provider}::${kind}::${categoryId}`;
}

function rememberHot<T>(provider: string, kind: 'vod' | 'series', categoryId: string, data: T[], updatedAt = Date.now()) {
  hotCatalogs.set(hotKey(provider, kind, categoryId), { updatedAt, data });
}

function readHot<T>(provider: string, kind: 'vod' | 'series', categoryId: string) {
  return hotCatalogs.get(hotKey(provider, kind, categoryId)) as { updatedAt: number; data: T[] } | undefined;
}

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
  provider: string,
  kind: 'vod' | 'series',
  categoryId: string
): Promise<T[] | null> {
  if (categoryId === 'all') return null;

  const hotAll = readHot<T>(provider, kind, 'all');
  if (hotAll?.data?.length) {
    const filtered = hotAll.data.filter((item) => item.category_id === categoryId);
    if (filtered.length) {
      rememberHot(provider, kind, categoryId, filtered, hotAll.updatedAt);
      return filtered;
    }
  }

  const all = await readCatalog<T[]>(provider, kind, 'all');
  if (!all?.data?.length) return null;
  rememberHot(provider, kind, 'all', all.data, all.updatedAt);
  const filtered = all.data.filter((item) => item.category_id === categoryId);
  if (filtered.length) rememberHot(provider, kind, categoryId, filtered, all.updatedAt);
  return filtered;
}

xtreamService.getVodStreams = async (categoryId: string = 'all'): Promise<VodMovie[]> => {
  const key = categoryId || 'all';
  const provider = providerKey();

  const hot = readHot<VodMovie>(provider, 'vod', key);
  if (hot?.data?.length && Date.now() - hot.updatedAt <= TTL_MS) return hot.data;

  const exact = await readCatalog<VodMovie[]>(provider, 'vod', key);
  if (exact?.data?.length) {
    rememberHot(provider, 'vod', key, exact.data, exact.updatedAt);
    if (Date.now() - exact.updatedAt > TTL_MS) {
      // Force the wrapped service's own RAM cache cold so stale-while-revalidate
      // actually reaches the provider instead of recycling an old in-memory array.
      xtreamService.clearCache();
      void deduped(
        `${provider}:vod:${key}`,
        () => originalVod(key),
        async (data) => {
          rememberHot(provider, 'vod', key, data);
          await writeCatalog(provider, 'vod', key, data);
        }
      ).catch((error) => console.warn('Background VOD refresh notice:', error));
    }
    return exact.data;
  }

  const filtered = await readFromAll<VodMovie>(provider, 'vod', key);
  if (filtered?.length) return filtered;

  return deduped(
    `${provider}:vod:${key}`,
    () => originalVod(key),
    async (data) => {
      rememberHot(provider, 'vod', key, data);
      await writeCatalog(provider, 'vod', key, data);
    }
  );
};

xtreamService.getSeries = async (categoryId: string = 'all'): Promise<SeriesItem[]> => {
  const key = categoryId || 'all';
  const provider = providerKey();

  const hot = readHot<SeriesItem>(provider, 'series', key);
  if (hot?.data?.length && Date.now() - hot.updatedAt <= TTL_MS) return hot.data;

  const exact = await readCatalog<SeriesItem[]>(provider, 'series', key);
  if (exact?.data?.length) {
    rememberHot(provider, 'series', key, exact.data, exact.updatedAt);
    if (Date.now() - exact.updatedAt > TTL_MS) {
      xtreamService.clearCache();
      void deduped(
        `${provider}:series:${key}`,
        () => originalSeries(key),
        async (data) => {
          rememberHot(provider, 'series', key, data);
          await writeCatalog(provider, 'series', key, data);
        }
      ).catch((error) => console.warn('Background Series refresh notice:', error));
    }
    return exact.data;
  }

  const filtered = await readFromAll<SeriesItem>(provider, 'series', key);
  if (filtered?.length) return filtered;

  return deduped(
    `${provider}:series:${key}`,
    () => originalSeries(key),
    async (data) => {
      rememberHot(provider, 'series', key, data);
      await writeCatalog(provider, 'series', key, data);
    }
  );
};

export async function invalidatePersistentCatalogs() {
  inFlight.clear();
  hotCatalogs.clear();
  await clearCatalogs();
}
