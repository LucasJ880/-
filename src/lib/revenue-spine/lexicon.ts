/**
 * Revenue Spine — 词表（国家 / 买家类型 / 材质 / 颜色 / 认证 / 贸易术语）
 * 纯数据 + 纯函数；供启发式抽取与分类共用。
 */

export interface CountryAlias {
  name: string;
  aliases: string[];
  cities?: string[];
}

export const COUNTRIES: CountryAlias[] = [
  { name: "Canada", aliases: ["canada", "canadian", "加拿大"], cities: ["toronto", "vancouver", "montreal", "calgary", "ottawa", "edmonton", "winnipeg", "mississauga", "多伦多", "温哥华"] },
  { name: "United States", aliases: ["usa", "u.s.a", "u.s.", "united states", "america", "american", "美国"], cities: ["new york", "los angeles", "chicago", "houston", "miami", "seattle", "dallas", "atlanta", "boston", "洛杉矶", "纽约"] },
  { name: "United Kingdom", aliases: ["uk", "u.k.", "united kingdom", "england", "britain", "british", "英国"], cities: ["london", "manchester", "birmingham", "伦敦"] },
  { name: "Australia", aliases: ["australia", "australian", "澳大利亚", "澳洲"], cities: ["sydney", "melbourne", "brisbane", "perth", "悉尼"] },
  { name: "Germany", aliases: ["germany", "german", "deutschland", "德国"], cities: ["berlin", "hamburg", "munich", "frankfurt"] },
  { name: "France", aliases: ["france", "french", "法国"], cities: ["paris", "lyon", "marseille"] },
  { name: "Italy", aliases: ["italy", "italian", "意大利"], cities: ["milan", "rome"] },
  { name: "Spain", aliases: ["spain", "spanish", "西班牙"], cities: ["madrid", "barcelona"] },
  { name: "Netherlands", aliases: ["netherlands", "holland", "dutch", "荷兰"], cities: ["amsterdam", "rotterdam"] },
  { name: "Japan", aliases: ["japan", "japanese", "日本"], cities: ["tokyo", "osaka"] },
  { name: "South Korea", aliases: ["korea", "south korea", "korean", "韩国"], cities: ["seoul", "busan"] },
  { name: "United Arab Emirates", aliases: ["uae", "u.a.e", "united arab emirates", "dubai", "阿联酋", "迪拜"], cities: ["dubai", "abu dhabi"] },
  { name: "Saudi Arabia", aliases: ["saudi", "saudi arabia", "沙特"], cities: ["riyadh", "jeddah"] },
  { name: "Mexico", aliases: ["mexico", "mexican", "墨西哥"], cities: ["mexico city"] },
  { name: "Brazil", aliases: ["brazil", "brazilian", "巴西"], cities: ["sao paulo"] },
  { name: "India", aliases: ["india", "indian", "印度"], cities: ["mumbai", "delhi"] },
  { name: "Singapore", aliases: ["singapore", "新加坡"], cities: ["singapore"] },
  { name: "Malaysia", aliases: ["malaysia", "马来西亚"] },
  { name: "Thailand", aliases: ["thailand", "泰国"] },
  { name: "Vietnam", aliases: ["vietnam", "越南"] },
  { name: "New Zealand", aliases: ["new zealand", "新西兰"], cities: ["auckland", "wellington"] },
  { name: "Sweden", aliases: ["sweden", "swedish", "瑞典"], cities: ["stockholm", "gothenburg", "malmo", "malmö"] },
  { name: "Norway", aliases: ["norway", "norwegian", "挪威"], cities: ["oslo", "bergen"] },
  { name: "Denmark", aliases: ["denmark", "danish", "丹麦"], cities: ["copenhagen", "aarhus"] },
  { name: "Poland", aliases: ["poland", "polish", "波兰"], cities: ["warsaw", "krakow"] },
  { name: "Turkey", aliases: ["turkey", "türkiye", "土耳其"], cities: ["istanbul", "ankara"] },
  { name: "South Africa", aliases: ["south africa", "南非"] },
  { name: "China", aliases: ["china", "中国", "国内"] },
];

const COUNTRY_BY_ALIAS: Map<string, CountryAlias> = new Map();
for (const c of COUNTRIES) for (const a of c.aliases) COUNTRY_BY_ALIAS.set(a, c);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface DetectedCountry {
  country: string;
  city: string | null;
  matched: string;
  index: number;
}

/** 文本中的国家/城市提及（按出现顺序） */
export function detectCountries(text: string): DetectedCountry[] {
  const lower = text.toLowerCase();
  const hits: DetectedCountry[] = [];
  for (const c of COUNTRIES) {
    for (const a of c.aliases) {
      const isAscii = /^[\x00-\x7f]+$/.test(a);
      const re = new RegExp(isAscii ? `(?<![a-z])${escapeRe(a)}(?![a-z])` : escapeRe(a), "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower))) {
        hits.push({ country: c.name, city: null, matched: m[0], index: m.index });
      }
    }
    for (const city of c.cities ?? []) {
      const isAscii = /^[\x00-\x7f]+$/.test(city);
      const re = new RegExp(isAscii ? `(?<![a-z])${escapeRe(city)}(?![a-z])` : escapeRe(city), "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower))) {
        hits.push({ country: c.name, city: city, matched: m[0], index: m.index });
      }
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

export function countryFromTld(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const tld = domain.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ca: "Canada", uk: "United Kingdom", au: "Australia", de: "Germany", fr: "France", it: "Italy", es: "Spain",
    nl: "Netherlands", jp: "Japan", kr: "South Korea", ae: "United Arab Emirates", sa: "Saudi Arabia", mx: "Mexico",
    br: "Brazil", in: "India", sg: "Singapore", my: "Malaysia", th: "Thailand", vn: "Vietnam", nz: "New Zealand",
    se: "Sweden", no: "Norway", dk: "Denmark", pl: "Poland", tr: "Turkey", za: "South Africa", cn: "China",
  };
  return tld ? map[tld] ?? null : null;
}

export function countryFromPhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").replace(/[\s\-()]/g, "");
  if (!p.startsWith("+")) return null;
  if (/^\+1/.test(p)) return "United States/Canada";
  if (/^\+44/.test(p)) return "United Kingdom";
  if (/^\+61/.test(p)) return "Australia";
  if (/^\+49/.test(p)) return "Germany";
  if (/^\+33/.test(p)) return "France";
  if (/^\+971/.test(p)) return "United Arab Emirates";
  if (/^\+86/.test(p)) return "China";
  if (/^\+81/.test(p)) return "Japan";
  if (/^\+82/.test(p)) return "South Korea";
  return null;
}

export interface BuyerTypeRule {
  type: string;
  keywords: string[];
}

/** 顺序即优先级（更具体的在前） */
export const BUYER_TYPE_RULES: BuyerTypeRule[] = [
  { type: "hotel_supplier", keywords: ["hotel supplier", "hospitality supplier", "hotel supply", "hotel amenities supplier", "酒店用品供应商", "酒店供应商"] },
  { type: "hotel_group", keywords: ["hotel group", "hotel chain", "resort", "our hotel", "our hotels", "hotel project", "酒店集团", "酒店项目", "连锁酒店"] },
  { type: "distributor", keywords: ["distributor", "distribution", "经销商", "分销商", "代理商"] },
  { type: "wholesaler", keywords: ["wholesaler", "wholesale", "批发"] },
  { type: "importer", keywords: ["importer", "import company", "进口商"] },
  { type: "brand", keywords: ["our brand", "brand owner", "private label", "own brand", "我们的品牌", "品牌商", "品牌方"] },
  { type: "retailer", keywords: ["retailer", "retail chain", "retail store", "our stores", "零售商", "零售"] },
  { type: "ecommerce", keywords: ["amazon", "shopify", "ecommerce", "e-commerce", "online store", "online shop", "电商", "跨境电商", "亚马逊"] },
  { type: "contractor", keywords: ["contractor", "interior design", "designer", "fit-out", "fitout", "承包商", "工程公司", "设计公司"] },
  { type: "sourcing_agent", keywords: ["sourcing agent", "buying agent", "sourcing company", "采购代理", "外贸公司"] },
  { type: "individual", keywords: ["for myself", "personal use", "my home", "my house", "for my family", "个人使用", "自用", "家里用"] },
];

export function detectBuyerType(text: string): { type: string; confidence: number; matched: string | null } {
  const lower = text.toLowerCase();
  for (const rule of BUYER_TYPE_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return { type: rule.type, confidence: 0.85, matched: kw };
    }
  }
  return { type: "unknown", confidence: 0.3, matched: null };
}

export const MATERIAL_KEYWORDS: string[] = [
  "100% cotton", "organic cotton", "egyptian cotton", "combed cotton", "cotton", "polyester", "microfiber", "micro fiber",
  "coral fleece", "flannel fleece", "flannel", "fleece", "sherpa", "velvet", "velour", "terry", "waffle", "bamboo",
  "linen", "silk", "satin", "wool", "cashmere", "acrylic", "nylon", "spandex", "modal", "tencel", "lyocell", "viscose",
  "faux fur", "blackout fabric", "triple weave", "纯棉", "全棉", "涤纶", "涤棉", "珊瑚绒", "法兰绒", "摇粒绒", "羊羔绒", "竹纤维", "亚麻",
  "真丝", "羊毛", "超细纤维", "毛圈", "华夫格", "天丝", "莫代尔",
];

export const COLOR_KEYWORDS: string[] = [
  "white", "off-white", "ivory", "black", "grey", "gray", "charcoal", "navy", "blue", "light blue", "sky blue", "beige",
  "cream", "brown", "taupe", "khaki", "green", "olive", "sage", "red", "burgundy", "pink", "blush", "purple", "yellow",
  "gold", "silver", "orange", "白色", "米白", "黑色", "灰色", "藏青", "蓝色", "米色", "棕色", "绿色", "红色", "粉色", "紫色", "黄色",
];

export const CERTIFICATION_KEYWORDS: string[] = [
  "oeko-tex", "oeko tex", "oekotex", "gots", "bsci", "sedex", "smeta", "iso 9001", "iso9001", "iso 14001", "grs", "ocs", "wrap",
  "reach", "ce", "fsc", "bci", "fr certificate", "flame retardant", "nfpa 701", "认证", "环保认证",
];

export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP", "DDU"] as const;

export const PACKAGING_KEYWORDS: string[] = [
  "packaging", "packing", "poly bag", "polybag", "pp bag", "opp bag", "gift box", "color box", "carton", "hang tag", "hangtag",
  "label", "woven label", "包装", "彩盒", "礼盒", "吊牌", "唛头",
];

export const CUSTOMIZATION_KEYWORDS: string[] = [
  "logo", "embroidery", "embroidered", "printed logo", "custom print", "branded", "private label", "oem", "odm", "customized",
  "customised", "custom design", "our design", "定制", "绣花", "印花", "印logo", "贴牌",
];

export const SAMPLE_KEYWORDS: string[] = ["sample", "samples", "sampling", "样品", "打样", "样板", "寄样"];

export const URGENCY_KEYWORDS: string[] = ["urgent", "asap", "as soon as possible", "immediately", "rush", "tight deadline", "紧急", "尽快", "急"];

export const INTENT_ASK_KEYWORDS: string[] = [
  "moq", "minimum order", "price", "pricing", "quote", "quotation", "cost", "lead time", "delivery time", "delivery",
  "production time", "ship", "shipping", "报价", "价格", "起订量", "最小起订", "交期", "货期", "交货", "运费",
];

export const APPLICATION_RULES: Array<{ key: string; keywords: string[] }> = [
  { key: "hospitality", keywords: ["hotel", "resort", "hospitality", "spa", "airbnb", "guest room", "酒店", "民宿", "客房"] },
  { key: "healthcare", keywords: ["hospital", "clinic", "nursing", "医院", "养老"] },
  { key: "retail", keywords: ["retail", "store", "shop", "零售", "门店"] },
  { key: "promotional", keywords: ["promotional", "giveaway", "corporate gift", "礼品", "赠品"] },
  { key: "residential", keywords: ["residential", "apartment", "condo", "home use", "住宅", "公寓"] },
  { key: "project", keywords: ["project", "tender", "contract", "工程", "项目", "招标"] },
];
