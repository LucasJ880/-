import { offlineDb, type SyncAction, type SyncStatus } from "./db";
import { apiFetch } from "@/lib/api-fetch";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

type SyncListener = (state: SyncState) => void;

export interface SyncState {
  isSyncing: boolean;
  pendingCount: number;
  currentIndex: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

let _state: SyncState = {
  isSyncing: false,
  pendingCount: 0,
  currentIndex: 0,
  lastSyncAt: null,
  lastError: null,
};

const _listeners = new Set<SyncListener>();

function emit() {
  const snapshot = { ..._state };
  _listeners.forEach((fn) => fn(snapshot));
}

export function subscribeSyncState(fn: SyncListener): () => void {
  _listeners.add(fn);
  fn({ ..._state });
  return () => _listeners.delete(fn);
}

export function getSyncState(): SyncState {
  return { ..._state };
}

async function processQueue(): Promise<void> {
  if (_state.isSyncing) return;
  if (!navigator.onLine) return;

  const actions = await offlineDb.syncQueue.orderBy("id").toArray();
  if (actions.length === 0) {
    _state = { ..._state, pendingCount: 0, isSyncing: false };
    emit();
    return;
  }

  _state = {
    ..._state,
    isSyncing: true,
    pendingCount: actions.length,
    currentIndex: 0,
    lastError: null,
  };
  emit();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    _state = { ..._state, currentIndex: i + 1 };
    emit();

    try {
      const res = await apiFetch(action.url, {
        method: action.method,
        headers: { "Content-Type": "application/json" },
        body: action.body,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(errText);
      }

      const responseData = await res.json().catch(() => ({}));
      const serverId = (responseData as Record<string, unknown>).id as string | undefined;

      if (serverId) {
        await updateLocalRecordServerId(action, serverId);
      }

      await offlineDb.syncQueue.delete(action.id!);
      await updateLocalRecordStatus(action.table, action.localId, "synced");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const newRetries = action.retries + 1;

      if (newRetries >= MAX_RETRIES) {
        await offlineDb.syncQueue.delete(action.id!);
        await updateLocalRecordStatus(action.table, action.localId, "error");
        _state = { ..._state, lastError: msg };
        emit();
        continue;
      }

      await offlineDb.syncQueue.update(action.id!, {
        retries: newRetries,
        lastError: msg,
      });

      const delay = BASE_DELAY_MS * Math.pow(2, newRetries - 1);
      await sleep(delay);
    }
  }

  _state = {
    ..._state,
    isSyncing: false,
    pendingCount: await offlineDb.syncQueue.count(),
    lastSyncAt: new Date().toISOString(),
  };
  emit();
}

async function updateLocalRecordServerId(action: SyncAction, serverId: string) {
  const table = getTable(action.table);
  if (!table) return;
  await table.update(action.localId, { serverId });
}

async function updateLocalRecordStatus(
  tableName: string,
  localId: string,
  status: SyncStatus
) {
  const table = getTable(tableName);
  if (!table) return;
  await table.update(localId, { syncStatus: status });
}

function getTable(name: string) {
  switch (name) {
    case "customers":
      return offlineDb.customers;
    case "measurements":
      return offlineDb.measurements;
    case "quotes":
      return offlineDb.quotes;
    default:
      return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueue(action: Omit<SyncAction, "id" | "retries" | "createdAt">) {
  await offlineDb.syncQueue.add({
    ...action,
    retries: 0,
    createdAt: new Date().toISOString(),
  });
  _state = {
    ..._state,
    pendingCount: await offlineDb.syncQueue.count(),
  };
  emit();

  if (navigator.onLine) {
    processQueue();
  }
}

let _initialized = false;

export function initSyncEngine() {
  if (_initialized) return;
  if (typeof window === "undefined") return;
  _initialized = true;

  window.addEventListener("online", () => {
    processQueue();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      processQueue();
    }
  });

  offlineDb.syncQueue.count().then((count) => {
    _state = { ..._state, pendingCount: count };
    emit();
  });

  if (navigator.onLine) {
    processQueue();
  }
}
