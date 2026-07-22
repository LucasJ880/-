import { redirect } from "next/navigation";

/** 旧路径兼容：配置健康统一为 /capabilities/config-health */
export default function CapabilitiesHealthRedirectPage() {
  redirect("/capabilities/config-health");
}
