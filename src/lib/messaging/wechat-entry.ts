/**
 * 微信入口开关（openspec change hide-wechat-entry / COLLAB-1）
 *
 *   WECHAT_BINDING_ENABLED   去首尾空白、不分大小写后为 1 / true / on 才开；
 *                            未设置、空串或其他任何值都为关（生产默认关）。
 *
 * 只管页面入口：登录页"微信扫码登录"、设置页"微信集成"卡片、侧边栏 / 手机抽屉"微信集成"、
 * /settings/wechat 与 /wechat 两个页面、组织开通页的微信步骤与成员表"微信"列。
 * 微信登录 / 绑定接口、回调与 wechat-push 推送不看这个开关。
 *
 * 只在服务端读取（(auth)、(main) 两个 layout 把结果交给 WechatEntryProvider）；
 * 不是 NEXT_PUBLIC_ 变量，改值后要重新部署。
 */

function envOn(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "on";
}

export function isWechatBindingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envOn(env.WECHAT_BINDING_ENABLED);
}
