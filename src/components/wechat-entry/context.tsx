"use client";

/**
 * 微信入口开关的客户端上下文（openspec change hide-wechat-entry / COLLAB-1）。
 * 值由 (auth)、(main) 两个服务端 layout 调 isWechatBindingEnabled() 算好传入；
 * 这里不读环境变量。没有上下文时为关。
 */
import { createContext, useContext } from "react";

const WechatEntryContext = createContext(false);

export function WechatEntryProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <WechatEntryContext.Provider value={enabled}>{children}</WechatEntryContext.Provider>;
}

/** 微信扫码登录与微信绑定入口是否开放（缺省 false）。 */
export function useWechatEntryEnabled(): boolean {
  return useContext(WechatEntryContext);
}
