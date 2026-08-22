/** 我方报价身份 / 默认条款：来自组织投标档案（settingsJson.tenderProfile.quoteHeader / quoteTerms），零 schema，不回退窗饰品牌档案 */
import { getTenderProfile } from "@/lib/tender-profile/store";
import type { CompanyIdentityView } from "./customer-view";

export async function getCompanyIdentity(orgId: string): Promise<CompanyIdentityView> {
  const p = await getTenderProfile(orgId);
  const h = p?.quoteHeader;
  const name = h?.companyName || p?.entityName || null;
  return { name: name || null, addressLines: h?.addressLines ?? [], phone: h?.phone || null, email: h?.email || null, website: h?.website || null, taxNumber: h?.taxNumber || null };
}

export async function getDefaultQuoteTerms(orgId: string): Promise<{ paymentTerms: string | null; delivery: string | null; leadTime: string | null; warranty: string | null; validity: string | null; exclusions: string[]; assumptions: string[]; notes: string | null; preparedBy: string | null }> {
  const p = await getTenderProfile(orgId);
  const t = p?.quoteTerms;
  return { paymentTerms: t?.paymentTerms || null, delivery: t?.delivery || null, leadTime: t?.leadTime || null, warranty: t?.warranty || null, validity: t?.validity || null, exclusions: t?.exclusions ?? [], assumptions: t?.assumptions ?? [], notes: t?.notes || null, preparedBy: p?.quoteHeader?.preparedByDefault || null };
}
