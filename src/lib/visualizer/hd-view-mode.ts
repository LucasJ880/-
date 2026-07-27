/**
 * HD 编辑器主区域显示模式（纯前端状态，无 DB 字段）。
 */

export type HdViewMode = "editing" | "rendering" | "rendered" | "error";

export function hdViewModeOnRenderStart(): HdViewMode {
  return "rendering";
}

export function hdViewModeOnRenderSuccess(): HdViewMode {
  return "rendered";
}

/** 失败：有旧成功图则保留展示，否则 error；绝不把色块预览标为完成 */
export function hdViewModeOnRenderFailure(args: {
  previousExportImageUrl: string | null | undefined;
}): HdViewMode {
  return args.previousExportImageUrl ? "rendered" : "error";
}

export function shouldShowKonvaEditor(mode: HdViewMode): boolean {
  return mode === "editing" || mode === "error";
}

export function shouldShowExportResult(
  mode: HdViewMode,
  exportImageUrl: string | null | undefined,
): boolean {
  return mode === "rendered" && !!exportImageUrl;
}

export function isHdSuccessMessageAllowed(args: {
  httpOk: boolean;
  exportImageUrl: string | null | undefined;
}): boolean {
  return args.httpOk && !!args.exportImageUrl;
}
