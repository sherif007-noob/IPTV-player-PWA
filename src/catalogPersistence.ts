import { xtreamService } from './services/xtream';
import { readCatalog, writeCatalog, clearCatalogs } from './services/catalogStore';
import { VodMovie, SeriesItem } from './types';
import { MOCK_MOVIES, MOCK_SERIES } from './services/mockData';

const TTL_MS = 6 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<any[]>>();
const hotCatalogs = new Map<string, { updatedAt: number; data: any[] }>();
let memoryGeneration = 0;

function hotKey(provider: string, kind: 'vod' | 'series', categoryId: string) {
  return `${provider}::${kind}::${categoryId}`;
}

function rememberHot<T>(provider: string, kind: 'vod' | 'series', categoryId: string, data: T[], updatedAt = Date.now()) {
  hotCatalogs.set(hotKey(provider, kind, categoryId), { updatedAt, data });
}

function readHot<T>(provider: string, kind: 'vod' | 'series', categoryId: string) {
  return hotCatalogs.get(hotKey(provider, kind, categoryId)) as { updatedAt: number; data: T[] } | undefined;
}

function matchesMockCatalog(kind: 'vod' | 'series', data: any[]) {
  if (kind === 'vod') {
    return data.length === MOCK_MOVIES.length &&
      data.every((item, index) =>
        Number(item?.stream_id) === Number(MOCK_MOVIES[index]?.stream_id) &&
        String(item?.name || '') === String(MOCK_MOVIES[index]?.name || '')
      );
  }
  return data.length === MOCK_SERIES.length &&
    data.every((item, index) =>
      Number(item?.series_id) === Number(MOCK_SERIES[index]?.series_id) &&
      String(item?.name || '') === String(MOCK_SERIES[index]?.name || '')
    );
}

async function persistRealCatalog<T>(
  provider: string,
  kind: 'vod' | 'series',
  categoryId: string,
  data: T[],
  requestGeneration: number
) {
  if (!data.length || xtreamService.getIsDemo() || matchesMockCatalog(kind, data as any[])) return;
  if (requestGeneration === memoryGeneration) {
    rememberHot(provider, kind, categoryId, data);
  }
  await writeCatalog(provider, kind, categoryId, data);
  if (requestGeneration !== memoryGeneration) {
    xtreamService.clearCache();
  }
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
  if (
    hotAll?.data?.length &&
    (xtreamService.getIsDemo() || !matchesMockCatalog(kind, hotAll.data as any[]))
  ) {
    const filtered = hotAll.data.filter((item) => item.category_id === categoryId);
    if (filtered.length) {
      rememberHot(provider, kind, categoryId, filtered, hotAll.updatedAt);
      return filtered;
    }
  }

  const all = await readCatalog<T[]>(provider, kind, 'all');
  if (!all?.data?.length) return null;
  if (!xtreamService.getIsDemo() && matchesMockCatalog(kind, all.data as any[])) {
    await clearCatalogs(provider);
    return null;
  }
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
  if (
    exact?.data?.length &&
    (xtreamService.getIsDemo() || !matchesMockCatalog('vod', exact.data))
  ) {
    rememberHot(provider, 'vod', key, exact.data, exact.updatedAt);
    if (Date.now() - exact.updatedAt > TTL_MS) {
      // Force the wrapped service's own RAM cache cold so stale-while-revalidate
      // actually reaches the provider instead of recycling an old in-memory array.
      xtreamService.clearCache();
      const requestGeneration = memoryGeneration;
      void deduped(
        `${provider}:vod:${key}`,
        () => originalVod(key),
        (data) => persistRealCatalog(provider, 'vod', key, data, requestGeneration)
      ).catch((error) => console.warn('Background VOD refresh notice:', error));
    }
    return exact.data;
  }
  if (exact?.data?.length && !xtreamService.getIsDemo() && matchesMockCatalog('vod', exact.data)) {
    hotCatalogs.delete(hotKey(provider, 'vod', key));
    await clearCatalogs(provider);
  }

  const filtered = await readFromAll<VodMovie>(provider, 'vod', key);
  if (filtered?.length) return filtered;

  const requestGeneration = memoryGeneration;
  const data = await deduped(
    `${provider}:vod:${key}`,
    () => originalVod(key),
    (result) => persistRealCatalog(provider, 'vod', key, result, requestGeneration)
  );
  if (!xtreamService.getIsDemo() && matchesMockCatalog('vod', data)) {
    throw new Error('VOD provider request failed; demo fallback was rejected.');
  }
  return data;
};

xtreamService.getSeries = async (categoryId: string = 'all'): Promise<SeriesItem[]> => {
  const key = categoryId || 'all';
  const provider = providerKey();

  const hot = readHot<SeriesItem>(provider, 'series', key);
  if (hot?.data?.length && Date.now() - hot.updatedAt <= TTL_MS) return hot.data;

  const exact = await readCatalog<SeriesItem[]>(provider, 'series', key);
  if (
    exact?.data?.length &&
    (xtreamService.getIsDemo() || !matchesMockCatalog('series', exact.data))
  ) {
    rememberHot(provider, 'series', key, exact.data, exact.updatedAt);
    if (Date.now() - exact.updatedAt > TTL_MS) {
      xtreamService.clearCache();
      const requestGeneration = memoryGeneration;
      void deduped(
        `${provider}:series:${key}`,
        () => originalSeries(key),
        (data) => persistRealCatalog(provider, 'series', key, data, requestGeneration)
      ).catch((error) => console.warn('Background Series refresh notice:', error));
    }
    return exact.data;
  }
  if (exact?.data?.length && !xtreamService.getIsDemo() && matchesMockCatalog('series', exact.data)) {
    hotCatalogs.delete(hotKey(provider, 'series', key));
    await clearCatalogs(provider);
  }

  const filtered = await readFromAll<SeriesItem>(provider, 'series', key);
  if (filtered?.length) return filtered;

  const requestGeneration = memoryGeneration;
  const data = await deduped(
    `${provider}:series:${key}`,
    () => originalSeries(key),
    (result) => persistRealCatalog(provider, 'series', key, result, requestGeneration)
  );
  if (!xtreamService.getIsDemo() && matchesMockCatalog('series', data)) {
    throw new Error('Series provider request failed; demo fallback was rejected.');
  }
  return data;
};

export function releaseCatalogMemory() {
  memoryGeneration += 1;
  hotCatalogs.clear();
  xtreamService.clearCache();
}

export async function invalidatePersistentCatalogs() {
  inFlight.clear();
  releaseCatalogMemory();
  await clearCatalogs();
}
