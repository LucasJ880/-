/**
 * 销售模块「当前组织」— 与全站 useCurrentOrgId 一致，避免各页重复解析。
 * @see useCurrentOrgId
 */
export {
  useCurrentOrgId as useSalesCurrentOrgId,
  persistSelectedOrgId,
  SELECTED_ORG_STORAGE_KEY,
} from "./use-current-org-id";
