/**
 * 导出青砚当前价表常量为 JSON（给 crosscheck.py 用）。
 * 运行：npx tsx scripts/pricelist/dump-pricing.ts > qingyan-pricing.json
 */
import * as d from "../../src/lib/blinds/pricing-data";

const out = {
  version: d.BASE_PRICE_VERSION,
  BRACKETS: d.BRACKETS,
  DEFAULT_DISCOUNTS: d.DEFAULT_DISCOUNTS,
  PRICE_FLOOR: d.PRICE_FLOOR,
  INSTALL_RULES: d.INSTALL_RULES,
  MSRP: {
    Zebra: d.MSRP_ZEBRA,
    SHANGRILA: d.MSRP_SHANGRILA,
    "Cordless Cellular": d.MSRP_CORDLESS_CELLULAR,
    SkylightHoneycomb: d.MSRP_SKYLIGHT_HONEYCOMB,
    Roller: d.MSRP_ROLLER,
    Drapery: d.MSRP_DRAPERY,
    Sheer: d.MSRP_SHEER,
    Shutters: d.MSRP_SHUTTERS,
    "Roman Shade": d.MSRP_ROMAN_SHADE,
  } as Record<string, Record<string, number[][]>>,
  ROLLER_FABRICS: d.ROLLER_FABRICS,
  DOOR_SCREEN_SHEER_RULES: d.DOOR_SCREEN_SHEER_RULES,
  consts: {
    DEFAULT_DELIVERY_FEE: d.DEFAULT_DELIVERY_FEE,
    DEFAULT_TAX_RATE: d.DEFAULT_TAX_RATE,
    DEFAULT_SUNNY_MOTOR_PRICE: d.DEFAULT_SUNNY_MOTOR_PRICE,
    DEFAULT_CORDLESS_MULTIPLIER: d.DEFAULT_CORDLESS_MULTIPLIER,
    CORDLESS_MAX_WIDTH: d.CORDLESS_MAX_WIDTH,
    CORDLESS_MAX_HEIGHT: d.CORDLESS_MAX_HEIGHT,
  },
};
process.stdout.write(JSON.stringify(out));
