import Dexie, { type Table } from "dexie";

export type SyncStatus = "pending" | "synced" | "error";

export interface OfflineCustomer {
  localId: string;
  serverId?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  notes?: string;
  tags?: string;
  syncStatus: SyncStatus;
  createdAt: string; // ISO
  updatedAt: string;
}

export interface OfflineMeasurement {
  localId: string;
  serverId?: string;
  customerLocalId: string;
  customerServerId?: string;
  opportunityId?: string;
  status: string;
  overallNotes?: string;
  windows: OfflineMeasurementWindow[];
  syncStatus: SyncStatus;
  measuredAt: string;
  updatedAt: string;
}

export interface OfflineMeasurementWindow {
  roomName: string;
  windowLabel?: string;
  widthIn: number;
  heightIn: number;
  measureType: string;
  product?: string;
  fabric?: string;
  cordless: boolean;
  notes?: string;
  sortOrder: number;
  photos?: OfflinePhoto[];
}

export interface OfflinePhoto {
  localId: string;
  fileName: string;
  blob: Blob;
  uploadedUrl?: string;
}

export interface OfflineQuote {
  localId: string;
  serverId?: string;
  customerLocalId: string;
  customerServerId?: string;
  opportunityId?: string;
  items: OfflineQuoteItem[];
  addons: OfflineQuoteAddon[];
  installMode: string;
  merchSubtotal: number;
  addonsSubtotal: number;
  installSubtotal: number;
  installApplied: number;
  deliveryFee: number;
  preTaxTotal: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  notes?: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineQuoteItem {
  product: string;
  fabric: string;
  widthIn: number;
  heightIn: number;
  cordless: boolean;
  msrp: number;
  discountPct: number;
  price: number;
  installFee: number;
  location?: string;
}

export interface OfflineQuoteAddon {
  addonKey: string;
  displayName: string;
  unitPrice: number;
  qty: number;
  subtotal: number;
}

export interface SyncAction {
  id?: number;
  table: string;
  localId: string;
  method: "POST" | "PUT" | "DELETE";
  url: string;
  body: string; // JSON stringified
  retries: number;
  lastError?: string;
  createdAt: string;
}

export interface OfflineSketch {
  localId: string;
  relatedType: "measurement" | "quote";
  relatedLocalId: string;
  imageBlob: Blob;
  createdAt: string;
}

class QingyanOfflineDB extends Dexie {
  customers!: Table<OfflineCustomer, string>;
  measurements!: Table<OfflineMeasurement, string>;
  quotes!: Table<OfflineQuote, string>;
  syncQueue!: Table<SyncAction, number>;
  sketches!: Table<OfflineSketch, string>;

  constructor() {
    super("qingyan-offline");
    this.version(1).stores({
      customers: "localId, serverId, syncStatus, updatedAt",
      measurements: "localId, serverId, customerLocalId, customerServerId, syncStatus, updatedAt",
      quotes: "localId, serverId, customerLocalId, customerServerId, syncStatus, updatedAt",
      syncQueue: "++id, table, localId, createdAt",
      sketches: "localId, relatedType, relatedLocalId",
    });
  }
}

export const offlineDb = new QingyanOfflineDB();
