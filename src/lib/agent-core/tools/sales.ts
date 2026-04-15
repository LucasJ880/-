/**
 * 销售域工具 — 注册到统一工具注册表
 *
 * 将销售 CRM 能力暴露给 Agent Core。
 * 各子模块在 import 时自动执行 registry.register()。
 */

import "./sales-customer";
import "./sales-quote";
import "./sales-opportunity";
import "./sales-interaction";
import "./sales-coaching";

export { ok } from "./sales-helpers";
