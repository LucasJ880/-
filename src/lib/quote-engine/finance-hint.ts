/**
 * CHAIN-2e 报价引擎没有权限时的白话说明（纯模块：客户端组件 import；不读库、不 import next/server）。
 * 「谁能看、找谁」与 CHAIN-2b 报价表助手同一句（COST_ACCESS_HINT_ZH），只换前面的对象。
 */
import { COST_ACCESS_HINT_ZH } from "@/lib/tender-pricing/finance-view";

/** 「报价与成本」卡、投标页报价区、「我方报价」卡、单个报价页：没有财务查看权时 */
export const QUOTE_COST_HIDDEN_HINT_ZH = `估算成本和毛利率${COST_ACCESS_HINT_ZH}`;

/** 投标页报价区：不能新建报价时（canEdit = false 的人一定不是负责人：负责人直通） */
export const QUOTE_EDIT_HIDDEN_HINT_ZH = "你不是本项目负责人，不能新建、修改或批准报价；需要的话请找项目负责人。";

/** 单个报价页读取失败时，后面接接口给的原因 */
export const QUOTE_LOAD_FAILED_PREFIX_ZH = "打不开这个报价：";
