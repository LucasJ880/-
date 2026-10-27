/**
 * 工艺单的非 Blinds 工艺参数（国内下单 / 窗帘 / Vinyl / 无模板行）与单头设置。
 *
 * 零 schema：这份 JSON 作为 AuditLog（targetType=blinds_order, action=process_order.spec）的 afterData
 * 追加保存，每次编辑一个新版本，读取取最新版本（见 design D2）。
 * 这里只定义结构与入参清洗，不做 I/O。
 */

import { DEFAULT_DRAPE_VERSION, DRAPE_VERSIONS, type DrapeRowInput, type DrapeVersion } from "./drapes-engine";
import type { DomesticRowInput } from "./domestic-engine";
import type { VinylWindowInput } from "./vinyl-engine";

export const PROCESS_SPEC_SCHEMA = "sunny-process-order-spec/v1";
export const AUDIT_ACTION_SPEC = "process_order.spec";
export const AUDIT_ACTION_GENERATED = "process_order.generated";
export const AUDIT_TARGET_ORDER = "blinds_order";
export const AUDIT_TARGET_QUOTE = "sales_quote";

export interface ProcessSpecSource {
  quoteId: string;
  orderNumber: string | null;
  signedAt: string | null;
  customerName: string;
}

export interface DrapeSpecRow extends DrapeRowInput {
  location: string;
  /** drape = 布帘行、sheer = 纱帘行（来自 Order Form 同一行的两半） */
  part: "drape" | "sheer";
}

export interface DomesticSpecRow extends DomesticRowInput {
  location: string;
  /** 报价 Order Form 原产品名（Cordless Cellular / Allusion …） */
  quoteProduct: string;
}

export interface VinylSpecWindow extends VinylWindowInput {
  /** 报价 Order Form 原值，供核对 */
  quoteFrame: string;
  quoteOpenDirection: string;
  quoteMidRail: string;
}

/** 没有工艺模板的行（Wooden 百叶、Grommet 窗帘、4-1/2" / Arch 百叶 …）：阻断，工厂处理后删除 */
export interface UnsupportedLine {
  section: "shutter" | "drape" | "shade";
  location: string;
  widthIn: number;
  heightIn: number;
  reasonZh: string;
}

/** 映射时套用默认值的记录；当前值仍等于默认值时在待核对中提示 */
export interface MappingNote {
  section: "blinds" | "domestic" | "drapes" | "vinyl" | "order";
  /** 段内行号（1 起）；order 级为 0 */
  line: number;
  field: string;
  value: string | number | null;
  messageZh: string;
}

export interface ProcessSpecSettings {
  drapeVersion: DrapeVersion;
  vinyl: {
    /** 2.5 / 3.5；null = 报价单的百叶尺寸原件不支持 */
    louver: number | null;
    louverQuote: string;
    color: string;
    defaultRod: string;
  };
}

export interface ProcessSpec {
  schema: typeof PROCESS_SPEC_SCHEMA;
  version: number;
  source: ProcessSpecSource | null;
  settings: ProcessSpecSettings;
  domestic: DomesticSpecRow[];
  drapes: DrapeSpecRow[];
  vinyl: VinylSpecWindow[];
  unsupported: UnsupportedLine[];
  notes: MappingNote[];
}

export function emptySpec(): ProcessSpec {
  return {
    schema: PROCESS_SPEC_SCHEMA,
    version: 0,
    source: null,
    settings: { drapeVersion: DEFAULT_DRAPE_VERSION, vinyl: { louver: 3.5, louverQuote: "", color: "白色", defaultRod: "" } },
    domestic: [],
    drapes: [],
    vinyl: [],
    unsupported: [],
    notes: [],
  };
}

// ─────────────────────────── 清洗（PUT 入参 / 读库） ───────────────────────────

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown, max = 300): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function frameCountOf(v: unknown): number | string {
  if (v === 4 || v === "4") return 4;
  const s = str(v).trim();
  return s === "3+1" ? "3+1" : s;
}

export function sanitizeSpec(raw: unknown, base?: ProcessSpec): ProcessSpec {
  const r = obj(raw);
  const s = obj(r.settings);
  const sv = obj(s.vinyl);
  const fallback = base ?? emptySpec();
  const drapeVersion = (DRAPE_VERSIONS as readonly string[]).includes(str(s.drapeVersion))
    ? (str(s.drapeVersion) as DrapeVersion)
    : fallback.settings.drapeVersion;
  const louverRaw = numOrNull(sv.louver);
  const keepV = <T,>(key: string, v: T, b: T): T => (key in sv ? v : b);
  return {
    schema: PROCESS_SPEC_SCHEMA,
    version: Math.max(0, Math.trunc(num(r.version))),
    source: base?.source ?? (r.source ? sanitizeSource(r.source) : null),
    settings: {
      drapeVersion,
      vinyl: {
        louver: keepV("louver", louverRaw === 2.5 || louverRaw === 3.5 ? louverRaw : null, fallback.settings.vinyl.louver),
        louverQuote: keepV("louverQuote", str(sv.louverQuote, 40), fallback.settings.vinyl.louverQuote),
        color: keepV("color", str(sv.color, 40), fallback.settings.vinyl.color),
        defaultRod: keepV("defaultRod", str(sv.defaultRod, 40), fallback.settings.vinyl.defaultRod),
      },
    },
    domestic: !("domestic" in r) ? fallback.domestic : arr(r.domestic).map((x) => {
      const o = obj(x);
      return {
        location: str(o.location), code: str(o.code), widthIn: num(o.widthIn), heightIn: num(o.heightIn),
        productType: str(o.productType, 40), sku: str(o.sku, 80), measure: str(o.measure, 20), control: str(o.control, 20),
        side: str(o.side, 20), headrail: str(o.headrail, 40), mount: str(o.mount, 20), remark: str(o.remark, 500),
        quoteProduct: str(o.quoteProduct, 60),
      };
    }),
    drapes: !("drapes" in r) ? fallback.drapes : arr(r.drapes).map((x) => {
      const o = obj(x);
      return {
        location: str(o.location), part: o.part === "sheer" ? "sheer" : "drape",
        widthIn: num(o.widthIn), heightIn: num(o.heightIn), sku: str(o.sku, 80), qty: num(o.qty),
        craft: str(o.craft, 20), layer: str(o.layer, 10), liner: str(o.liner, 10), fullness: num(o.fullness),
        mount: str(o.mount, 20), rod: str(o.rod, 20), rodColor: str(o.rodColor, 20),
      } satisfies DrapeSpecRow;
    }),
    vinyl: !("vinyl" in r) ? fallback.vinyl : arr(r.vinyl, 60).map((x) => {
      const o = obj(x);
      return {
        location: str(o.location), width: num(o.width), height: num(o.height), panels: Math.trunc(num(o.panels)),
        openCode: str(o.openCode, 30).toUpperCase(), posts: str(o.posts, 4).toUpperCase(),
        rail1In: numOrNull(o.rail1In), rail1Ratio: numOrNull(o.rail1Ratio), rod: str(o.rod, 40),
        split: str(o.split, 20), frame: str(o.frame, 10), frameCount: frameCountOf(o.frameCount),
        inOut: str(o.inOut, 5).toUpperCase(), structure: str(o.structure, 5) === "无框" ? "无框" : "有框",
        rail2In: numOrNull(o.rail2In),
        quoteFrame: str(o.quoteFrame, 20), quoteOpenDirection: str(o.quoteOpenDirection, 20), quoteMidRail: str(o.quoteMidRail, 100),
      } satisfies VinylSpecWindow;
    }),
    unsupported: !("unsupported" in r) ? fallback.unsupported : arr(r.unsupported).map((x) => {
      const o = obj(x);
      const section = o.section === "drape" ? "drape" : o.section === "shade" ? "shade" : "shutter";
      return { section, location: str(o.location), widthIn: num(o.widthIn), heightIn: num(o.heightIn), reasonZh: str(o.reasonZh, 200) } as UnsupportedLine;
    }),
    notes: base?.notes ?? arr(r.notes, 500).map((x) => {
      const o = obj(x);
      const sec = str(o.section);
      return {
        section: (["blinds", "domestic", "drapes", "vinyl", "order"].includes(sec) ? sec : "order") as MappingNote["section"],
        line: Math.trunc(num(o.line)), field: str(o.field, 40),
        value: typeof o.value === "number" || typeof o.value === "string" ? o.value : null,
        messageZh: str(o.messageZh, 300),
      };
    }),
  };
}

function sanitizeSource(v: unknown): ProcessSpecSource {
  const o = obj(v);
  return {
    quoteId: str(o.quoteId, 60),
    orderNumber: o.orderNumber ? str(o.orderNumber, 120) : null,
    signedAt: o.signedAt ? str(o.signedAt, 40) : null,
    customerName: str(o.customerName),
  };
}
