import type {
  MediaAssetMeta,
  StudioProject,
} from "../../../shared/types";

const DB_NAME = "midnight-frequency-studio";
const DB_VERSION = 1;
const MEDIA_STORE = "media";
const PROJECT_STORE = "projects";

export interface MediaRecord {
  meta: MediaAssetMeta;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE))
        db.createObjectStore(MEDIA_STORE, { keyPath: "meta.id" });
      if (!db.objectStoreNames.contains(PROJECT_STORE))
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("本地音频库无法打开"));
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () =>
          reject(request.error ?? new Error("本地存储读写失败"));
      }),
  );
}

/**
 * 写入录音。IndexedDB 的 put 只在事务成功后覆盖旧值，
 * 因此配额超限时抛出异常，库里仍保留上一份可用版本。
 */
export async function putMedia(record: MediaRecord): Promise<void> {
  await tx(MEDIA_STORE, "readwrite", (s) => s.put(record));
}

export async function getMedia(id: string): Promise<MediaRecord | undefined> {
  return tx<MediaRecord | undefined>(MEDIA_STORE, "readonly", (s) => s.get(id));
}

export async function allMedia(): Promise<MediaRecord[]> {
  return tx<MediaRecord[]>(MEDIA_STORE, "readonly", (s) => s.getAll());
}

export async function deleteMedia(id: string): Promise<void> {
  await tx(MEDIA_STORE, "readwrite", (s) => s.delete(id));
}

export async function allProjects(): Promise<StudioProject[]> {
  return tx<StudioProject[]>(PROJECT_STORE, "readonly", (s) => s.getAll());
}

export async function putProject(project: StudioProject): Promise<void> {
  // 深拷贝避免 IndexedDB 结构化克隆持有实时引用
  await tx(PROJECT_STORE, "readwrite", (s) =>
    s.put(structuredClone(project)),
  );
}

export async function deleteProject(id: string): Promise<void> {
  await tx(PROJECT_STORE, "readwrite", (s) => s.delete(id));
}
