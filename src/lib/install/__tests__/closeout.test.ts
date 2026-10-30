/**
 * INSTALL-1：逐窗收口纯函数（聚合 / 未收口清单 / 路径 / 上传校验）
 * 运行：npx tsx src/lib/install/__tests__/closeout.test.ts
 */
import {
  aggregateCloseout,
  installPhotoPathname,
  missingWindows,
  parseInstallPhotoPath,
  validatePhotoUpload,
  type CloseoutLog,
  type WindowItem,
} from "../closeout";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

console.log("INSTALL-1 收口聚合");
const items: WindowItem[] = [
  { id: "w1", itemNumber: 1, location: "主卧", width: 36, height: 48, productType: "Zebra", fabricSku: "A-LF" },
  { id: "w2", itemNumber: 2, location: "客厅", width: 72, height: 60, productType: "Roller", fabricSku: "B-BO" },
  { id: "w3", itemNumber: 3, location: "厨房", width: 30, height: 40, productType: "Zebra", fabricSku: "A-LF" },
  { id: "w4", itemNumber: 4, location: "书房", width: 40, height: 50, productType: "Roman Shade", fabricSku: "C-LF" },
];
const log = (targetId: string, at: string, n: number): CloseoutLog => ({
  targetId,
  createdAt: at,
  userId: "u-installer",
  afterData: JSON.stringify({ orderId: "o1", appointmentId: "a1", pathname: `install-photos/org/o1/${targetId}/${n}.jpg`, proxyUrl: `/api/files/install-photos/org/o1/${targetId}/${n}.jpg`, note: n === 2 ? "补拍" : "" }),
});
const logs: CloseoutLog[] = [
  log("w1", "2026-10-28T10:00:00Z", 1),
  log("w2", "2026-10-28T10:05:00Z", 1),
  log("w3", "2026-10-28T10:10:00Z", 1),
  log("w3", "2026-10-28T10:20:00Z", 2),
  log("w3", "2026-10-28T10:30:00Z", 3),
  { targetId: "w4", createdAt: "2026-10-28T10:40:00Z", userId: "x", afterData: "{bad json" },
  { targetId: null, createdAt: "2026-10-28T10:41:00Z", userId: "x", afterData: null },
];
const agg = aggregateCloseout(items, logs);
ok(agg.total === 4 && agg.completed === 3 && !agg.allCompleted, "4 扇窗，3 扇有照片，未全部完成");
ok(agg.windows[2].itemId === "w3" && agg.windows[2].photoCount === 3 && agg.windows[2].latest?.pathname.endsWith("/3.jpg"), "补拍 3 张 → 张数 3，最新为第 3 张");
ok(agg.windows[2].photos[2].note === null && agg.windows[2].photos[1].note === "补拍", "备注原样保留，空备注为 null");
ok(agg.windows[3].photoCount === 0 && agg.windows[3].latest === null, "坏 JSON 记录不计入");
ok(missingWindows(agg).length === 1 && missingWindows(agg)[0].itemNumber === 4 && missingWindows(agg)[0].location === "书房", "未收口清单：第 4 扇 书房");
const full = aggregateCloseout(items, [...logs, log("w4", "2026-10-28T11:00:00Z", 1)]);
ok(full.allCompleted && missingWindows(full).length === 0, "全部有照片 → allCompleted");
ok(!aggregateCloseout([], []).allCompleted, "无窗 → 不算完成");
ok(aggregateCloseout(items, logs).windows.map((w) => w.itemNumber).join(",") === "1,2,3,4", "按窗序号排序");

console.log("INSTALL-1 路径与校验");
const p = installPhotoPathname({ orgId: "org1", orderId: "o/1", itemId: "w1", ext: "jpg", now: new Date(1000) });
ok(p === "install-photos/org1/o1/w1/1000.jpg", "路径：前缀 / org / order / item / ts.ext，非法字符剔除");
ok(parseInstallPhotoPath(p.split("/"))?.orderId === "o1", "路径解析");
ok(parseInstallPhotoPath(["install-photos", "org1"]) === null && parseInstallPhotoPath(["ai-chat", "a", "b", "c", "d"]) === null, "非法路径 → null");
ok(validatePhotoUpload({ contentType: "image/jpeg", size: 2 * 1024 * 1024 }).ok, "2MB jpeg 通过");
ok(validatePhotoUpload({ contentType: "image/png; charset=binary", size: 100 }).ok, "png 带参数通过");
ok(!validatePhotoUpload({ contentType: "application/pdf", size: 100 }).ok, "pdf 拒绝");
ok(!validatePhotoUpload({ contentType: "image/jpeg", size: 12 * 1024 * 1024 }).ok, "12MB 拒绝");
ok(!validatePhotoUpload({ contentType: "image/jpeg", size: 0 }).ok, "空文件拒绝");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
