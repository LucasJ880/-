/**
 * 统一工具注册入口
 *
 * import 即触发注册（side-effect imports）。
 * 新增域的工具只需在此加一行 import。
 *
 * PR1：所有工具 import 完成后，立即应用 RBAC 策略表
 *      （给每个工具打上 risk + allowRoles 标签）。
 */

import "./trade";
import "./sales";
import "./sales-drafts"; // PR4: 草稿型写工具
import "./secretary";
import "./skills";
import "./context";
import "./cockpit";

import { applyToolPolicy } from "./_policy";

// 模块加载时仅执行一次。后续调用都走已打标签的 registry。
applyToolPolicy();
