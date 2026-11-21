/**
 * 覆盖清单里「未纳入」原因的文案（纯函数，客户端 / 服务端都能引用，不依赖数据库）。
 *
 * FIX-13：解析失败的文件在「文件解析失败」后面带上系统记下的失败原文，
 * 让人不用问就知道文件为什么没纳入。原文只在登录后的网页上显示，
 * 不进模型提示、Muse 通道与通知。
 */

/** 解析失败这一种排除原因的标签（package-coverage 的 parse_failed） */
export const PARSE_FAILED_REASON_LABEL = "文件解析失败";

/** 解析失败但系统没有记下原因时的说法 */
export const PARSE_ERROR_MISSING_TEXT = "系统未记录原因";

/** 这条排除原因是不是「解析失败」 */
export function isParseFailedReason(exclusionReason: string): boolean {
  return exclusionReason === PARSE_FAILED_REASON_LABEL;
}

/**
 * 「未纳入：」后面的那段文字。
 * 解析失败 →「文件解析失败（原因：〈原文〉）」，没有原文 →「（原因：系统未记录原因）」；
 * 其它原因（格式不支持、超出页数上限）原样返回。
 */
export function exclusionReasonWithParseError(
  exclusionReason: string,
  parseError: string | null | undefined,
): string {
  if (!isParseFailedReason(exclusionReason)) return exclusionReason;
  return `${exclusionReason}（原因：${parseError?.trim() || PARSE_ERROR_MISSING_TEXT}）`;
}

/**
 * 「文件名 → 解析失败原文」对照：只收当前因解析失败被排除的文件。
 * 给「排除 K（原因）」展开列表用——那份列表来自分析完成时的快照（不存原文），
 * 原文按文件名取当前的记录；对照里没有的文件（之后重新解析成功了）只显示标签。
 */
export function parseErrorsByFilename(
  excludedFiles: ReadonlyArray<{
    filename: string;
    exclusionReason: string;
    parseError?: string | null;
  }>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of excludedFiles) {
    if (isParseFailedReason(f.exclusionReason)) {
      out[f.filename] = f.parseError?.trim() || null;
    }
  }
  return out;
}

/**
 * 快照里的一条排除记录怎么显示：当前仍因解析失败被排除 → 带原文；否则只显示快照里的原因。
 */
export function snapshotExclusionText(
  exclusionReason: string,
  filename: string,
  currentParseErrors: Readonly<Record<string, string | null>> | undefined,
): string {
  if (
    !currentParseErrors ||
    !isParseFailedReason(exclusionReason) ||
    !Object.prototype.hasOwnProperty.call(currentParseErrors, filename)
  ) {
    return exclusionReason;
  }
  return exclusionReasonWithParseError(exclusionReason, currentParseErrors[filename]);
}
