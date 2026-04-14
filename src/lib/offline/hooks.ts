"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  offlineDb,
  type OfflineCustomer,
  type OfflineMeasurement,
  type OfflineQuote,
} from "./db";
import {
  initSyncEngine,
  subscribeSyncState,
  enqueue,
  type SyncState,
} from "./sync-engine";
import { apiFetch } from "@/lib/api-fetch";

/* ─── Online status ─── */

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}

/* ─── Sync state ─── */

export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>({
    isSyncing: false,
    pendingCount: 0,
    currentIndex: 0,
    lastSyncAt: null,
    lastError: null,
  });

  useEffect(() => {
    initSyncEngine();
    return subscribeSyncState(setState);
  }, []);

  return state;
}

/* ─── Offline customers ─── */

export function useOfflineCustomers() {
  const [customers, setCustomers] = useState<OfflineCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const local = await offlineDb.customers.orderBy("updatedAt").reverse().toArray();
    if (mountedRef.current) {
      setCustomers(local);
      setLoading(false);
    }
  }, []);

  const refreshFromServer = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await apiFetch("/api/sales/customers");
      if (!res.ok) return;
      const data = await res.json();
      const list = (data as { data?: Record<string, unknown>[] }).data ?? (data as Record<string, unknown>[]);
      if (!Array.isArray(list)) return;

      for (const c of list) {
        const existing = await offlineDb.customers
          .where("serverId")
          .equals(c.id as string)
          .first();
        if (existing) {
          if (existing.syncStatus === "pending") continue;
          await offlineDb.customers.update(existing.localId, {
            name: c.name as string,
            phone: c.phone as string | undefined,
            email: c.email as string | undefined,
            address: c.address as string | undefined,
            source: c.source as string | undefined,
            notes: c.notes as string | undefined,
            tags: c.tags as string | undefined,
            syncStatus: "synced" as const,
            updatedAt: (c.updatedAt as string) || new Date().toISOString(),
          });
        } else {
          await offlineDb.customers.put({
            localId: `server-${c.id}`,
            serverId: c.id as string,
            name: c.name as string,
            phone: c.phone as string | undefined,
            email: c.email as string | undefined,
            address: c.address as string | undefined,
            source: c.source as string | undefined,
            notes: c.notes as string | undefined,
            tags: c.tags as string | undefined,
            syncStatus: "synced",
            createdAt: (c.createdAt as string) || new Date().toISOString(),
            updatedAt: (c.updatedAt as string) || new Date().toISOString(),
          });
        }
      }

      load();
    } catch {
      // offline or error — silent
    }
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    load().then(refreshFromServer);
    return () => {
      mountedRef.current = false;
    };
  }, [load, refreshFromServer]);

  const saveCustomer = useCallback(
    async (
      customer: Omit<OfflineCustomer, "localId" | "syncStatus" | "createdAt" | "updatedAt">
    ) => {
      const now = new Date().toISOString();
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record: OfflineCustomer = {
        ...customer,
        localId,
        syncStatus: "pending",
        createdAt: now,
        updatedAt: now,
      };
      await offlineDb.customers.add(record);

      await enqueue({
        table: "customers",
        localId,
        method: "POST",
        url: "/api/sales/customers",
        body: JSON.stringify({
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          source: customer.source,
          notes: customer.notes,
          tags: customer.tags,
        }),
      });

      load();
      return localId;
    },
    [load]
  );

  return { customers, loading, saveCustomer, refresh: load };
}

/* ─── Offline measurements ─── */

export function useOfflineMeasurements(customerLocalId?: string) {
  const [measurements, setMeasurements] = useState<OfflineMeasurement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let results: OfflineMeasurement[];
    if (customerLocalId) {
      results = await offlineDb.measurements
        .where("customerLocalId")
        .equals(customerLocalId)
        .toArray();
    } else {
      results = await offlineDb.measurements.orderBy("updatedAt").reverse().toArray();
    }
    setMeasurements(results);
    setLoading(false);
  }, [customerLocalId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveMeasurement = useCallback(
    async (
      m: Omit<OfflineMeasurement, "localId" | "syncStatus" | "updatedAt">
    ) => {
      const now = new Date().toISOString();
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const customer = await offlineDb.customers.get(m.customerLocalId);
      const customerServerId = customer?.serverId;

      const record: OfflineMeasurement = {
        ...m,
        localId,
        customerServerId,
        syncStatus: customerServerId ? "pending" : "pending",
        updatedAt: now,
      };
      await offlineDb.measurements.add(record);

      if (customerServerId) {
        await enqueue({
          table: "measurements",
          localId,
          method: "POST",
          url: "/api/sales/measurements",
          body: JSON.stringify({
            customerId: customerServerId,
            opportunityId: m.opportunityId,
            status: m.status,
            overallNotes: m.overallNotes,
            measuredAt: m.measuredAt,
            windows: m.windows.map((w) => ({
              roomName: w.roomName,
              windowLabel: w.windowLabel,
              widthIn: w.widthIn,
              heightIn: w.heightIn,
              measureType: w.measureType,
              product: w.product,
              fabric: w.fabric,
              cordless: w.cordless,
              notes: w.notes,
              sortOrder: w.sortOrder,
            })),
          }),
        });
      }

      load();
      return localId;
    },
    [load]
  );

  return { measurements, loading, saveMeasurement, refresh: load };
}

/* ─── Offline quotes ─── */

export function useOfflineQuotes(customerLocalId?: string) {
  const [quotes, setQuotes] = useState<OfflineQuote[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let results: OfflineQuote[];
    if (customerLocalId) {
      results = await offlineDb.quotes
        .where("customerLocalId")
        .equals(customerLocalId)
        .toArray();
    } else {
      results = await offlineDb.quotes.orderBy("updatedAt").reverse().toArray();
    }
    setQuotes(results);
    setLoading(false);
  }, [customerLocalId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveQuote = useCallback(
    async (q: Omit<OfflineQuote, "localId" | "syncStatus" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const customer = await offlineDb.customers.get(q.customerLocalId);
      const customerServerId = customer?.serverId;

      const record: OfflineQuote = {
        ...q,
        localId,
        customerServerId,
        syncStatus: "pending",
        createdAt: now,
        updatedAt: now,
      };
      await offlineDb.quotes.add(record);

      if (customerServerId) {
        await enqueue({
          table: "quotes",
          localId,
          method: "POST",
          url: "/api/sales/quotes",
          body: JSON.stringify({
            customerId: customerServerId,
            opportunityId: q.opportunityId,
            installMode: q.installMode,
            merchSubtotal: q.merchSubtotal,
            addonsSubtotal: q.addonsSubtotal,
            installSubtotal: q.installSubtotal,
            installApplied: q.installApplied,
            deliveryFee: q.deliveryFee,
            preTaxTotal: q.preTaxTotal,
            taxRate: q.taxRate,
            taxAmount: q.taxAmount,
            grandTotal: q.grandTotal,
            notes: q.notes,
            items: q.items,
            addons: q.addons,
          }),
        });
      }

      load();
      return localId;
    },
    [load]
  );

  return { quotes, loading, saveQuote, refresh: load };
}
