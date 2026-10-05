/**
 * Minimal stand-in for folia's `src/services/db.ts`.
 *
 * Upstream this file is a thin façade over a Dexie database that holds the
 * whole app (local library, sessions, cover blobs, theme registry…). The
 * visualizer only ever touches its **key/value cache** half — the image packs
 * (Cappella avatars/emoji, Monet portrait, Tempera layer images) and the online
 * lyrics state all round-trip through `getFromCache` / `saveToCache`.
 *
 * So this shim keeps exactly that: one IndexedDB object store named `cache`,
 * with the same async signatures and the same "never throw, log instead"
 * behaviour. Everything the upstream file exports for the *library* side is
 * intentionally absent — nothing on the `/pc` page imports it.
 */

import type { MigrationResult } from '../utils/lyrics/renderHints';

const DB_NAME = 'folia-visualizer';
const DB_VERSION = 1;
const STORE = 'cache';

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });

    return dbPromise;
};

const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> => {
    const db = await openDb();
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
        try {
            const tx = db.transaction(STORE, mode);
            const request = run(tx.objectStore(STORE));
            request.onsuccess = () => resolve(request.result as T);
            request.onerror = () => resolve(null);
        } catch (error) {
            resolve(null);
        }
    });
};

export const saveToCache = async (key: string, data: unknown): Promise<void> => {
    try {
        await withStore('readwrite', (store) => store.put(data, key));
    } catch (error) {
        console.error('Cache save failed', error);
    }
};

export const getFromCache = async <T>(key: string): Promise<T | null> => {
    try {
        const value = await withStore<T>('readonly', (store) => store.get(key));
        return value === undefined ? null : value;
    } catch (error) {
        return null;
    }
};

export const getFromCacheWithMigration = async <T>(
    key: string,
    migrate: (data: T) => MigrationResult<T>,
): Promise<T | null> => {
    const cached = await getFromCache<T>(key);
    if (!cached) return null;
    const migration = migrate(cached);
    if (migration.changed) {
        void saveToCache(key, migration.value).catch(() => { /* best effort */ });
    }
    return migration.value;
};

export const removeFromCache = async (key: string): Promise<void> => {
    try {
        await withStore('readwrite', (store) => store.delete(key));
    } catch (error) {
        console.error('Cache remove failed', error);
    }
};

export const clearCache = async (preserveKeys: string[] = []): Promise<void> => {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const request = store.getAllKeys();
            request.onsuccess = () => {
                const keep = new Set(preserveKeys);
                request.result.forEach((key) => {
                    if (!keep.has(String(key))) store.delete(key);
                });
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (error) {
            resolve();
        }
    });
};

export const clearCacheByCategory = async (_category: string): Promise<void> => {
    // Categories upstream separate library / cache / session entries; this shim
    // has a single store, so the only honest answer is to clear everything.
    await clearCache();
};

// Types the upstream façade re-exports; kept so `import type` sites compile.
export type CacheData = Record<string, unknown>;
export type SessionData = Record<string, unknown>;
