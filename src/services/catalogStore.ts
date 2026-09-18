import { ContentType } from '../types';

type CatalogKind = Extract<ContentType, 'vod' | 'series'>;

interface CatalogRecord<T = unknown> {
  key: string;
  provider: string;
  kind: CatalogKind;
  categoryId: string;
  updatedAt: number;
  data: T;
}

const DB_NAME = 'iptv-player-cache';
const DB_VERSION = 1;
const STORE = 'catalogs';

function supported() {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!supported()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('provider', 'provider', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readCatalog<T>(
  provider: string,
  kind: CatalogKind,
  categoryId: string
): Promise<CatalogRecord<T> | null> {
  const db = await openDb();
  if (!db) return null;
  const key = `${provider}::${kind}::${categoryId}`;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as CatalogRecord<T> | undefined) || null);
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
  });
}

export async function writeCatalog<T>(
  provider: string,
  kind: CatalogKind,
  categoryId: string,
  data: T
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const record: CatalogRecord<T> = {
    key: `${provider}::${kind}::${categoryId}`,
    provider,
    kind,
    categoryId,
    updatedAt: Date.now(),
    data,
  };
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

export async function clearCatalogs(provider?: string): Promise<void> {
  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    if (!provider) {
      store.clear();
    } else {
      const index = store.index('provider');
      const request = index.openCursor(IDBKeyRange.only(provider));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}
