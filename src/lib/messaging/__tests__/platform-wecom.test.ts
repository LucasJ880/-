import { describe, expect, it } from "vitest";
import {
  PLATFORM_WECOM_ORG_ID,
  isPlatformWecomOrgKey,
  resolveWecomCredentialOrgId,
} from "../platform-wecom";

describe("platform-wecom credential key", () => {
  it("treats empty / platform / sentinel as platform", () => {
    expect(isPlatformWecomOrgKey(null)).toBe(true);
    expect(isPlatformWecomOrgKey("")).toBe(true);
    expect(isPlatformWecomOrgKey("platform")).toBe(true);
    expect(isPlatformWecomOrgKey(PLATFORM_WECOM_ORG_ID)).toBe(true);
    expect(isPlatformWecomOrgKey("org_abc")).toBe(false);
  });

  it("resolves credential org id", () => {
    expect(resolveWecomCredentialOrgId(null)).toBe(PLATFORM_WECOM_ORG_ID);
    expect(resolveWecomCredentialOrgId("platform")).toBe(PLATFORM_WECOM_ORG_ID);
    expect(resolveWecomCredentialOrgId("org_abc")).toBe("org_abc");
  });
});
