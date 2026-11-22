/**
 * 「文件解析失败」相关的界面文案（纯函数，客户端 / 服务端都能引用，不依赖数据库）。
 *
 * FIX-13：解析失败的文件在「文件解析失败」后面带上系统记下的失败原文，
 * 让人不用问就知道文件为什么没纳入。原文只在登录后的网页上显示，
 * 不进模型提示、Muse 通道与通知。
 */

/** 解析失败这一种排除原因的标签（package-coverage 的 parse_failed） */
export const PARSE_FAILED_REASON_LABEL = "文件解析失败";

/** 解析失败但系统没有记下原因时的说法（与 AI 任务详情页 STOP_REASON_UNRECORDED_ZH 同一句，全站一致） */
export const PARSE_ERROR_MISSING_TEXT = "系统未记录原因";

/** 分析面板上，有解析失败的文件时加在清单下面的一句「下一步怎么办」 */
export const PARSE_FAILED_NEXT_STEP_HINT =
  "解析失败的文件 AI 没有读到。原因里写了怎么处理的，先照着做；没写的，请到右上角「项目文件」里重新处理，再回到这里重新分析；仍然失败请把上面的原因发给管理员。";

/** 快照里记着解析失败、而文件现在已经不在「解析失败」之列时，加在标签后面的说明 */
export const SNAPSHOT_STALE_NOTE =
  "（这是上次分析时的情况；文件之后已重新处理或已删除，重新分析后这里会更新）";

/**
 * 能读的文件比这次纳入分析的多时（例如按提示重新处理成功之后），加在清单下面的一句；不多时为 null。
 * 覆盖清单的 note 只在没有被排除的文件时才说这件事，所以面板按计数自己拼。
 */
export function notYetAnalyzedHint(eligible: number, analyzed: number): string | null {
  const n = eligible - analyzed;
  if (!Number.isFinite(n) || n <= 0) return null;
  return `有 ${n} 个能读的文件还没纳入这次分析，重新分析后会一起纳入。`;
}

/** 这条排除原因是不是「解析失败」 */
export function isParseFailedReason(exclusionReason: string): boolean {
  return exclusionReason === PARSE_FAILED_REASON_LABEL;
}

/** 被排除的文件里有没有解析失败的（决定要不要显示「下一步怎么办」那一句） */
export function hasParseFailedExclusion(
  excludedFiles: ReadonlyArray<{ exclusionReason: string }>,
): boolean {
  return excludedFiles.some((f) => isParseFailedReason(f.exclusionReason));
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
 * 原文按文件名取当前的记录。快照里没有文件 id，只能按文件名对；
 * 两个同名的失败文件会共用后一个的原文。
 */
export function parseErrorsByFilename(
  excludedFiles: ReadonlyArray<{
    filename: string;
    exclusionReason: string;
    parseError?: string | null;
  }>,
): Record<string, string | null> {
  // 没有原型的对象：文件名叫 __proto__ / constructor 也只是普通的键
  const out: Record<string, string | null> = Object.create(null);
  for (const f of excludedFiles) {
    if (isParseFailedReason(f.exclusionReason)) {
      out[f.filename] = f.parseError?.trim() || null;
    }
  }
  return out;
}

/**
 * 快照里的一条排除记录怎么显示：
 * - 不是解析失败，或拿不到当前清单 → 快照里的原因原样显示；
 * - 当前仍因解析失败被排除 → 带上当前的原文；
 * - 当前已经不在解析失败之列（重新处理成功了，或文件已删除）→ 标签后面注明这是上次分析时的记录。
 */
export function snapshotExclusionText(
  exclusionReason: string,
  filename: string,
  currentParseErrors: Readonly<Record<string, string | null>> | undefined,
): string {
  if (!currentParseErrors || !isParseFailedReason(exclusionReason)) {
    return exclusionReason;
  }
  if (!Object.prototype.hasOwnProperty.call(currentParseErrors, filename)) {
    return `${exclusionReason}${SNAPSHOT_STALE_NOTE}`;
  }
  return exclusionReasonWithParseError(exclusionReason, currentParseErrors[filename]);
}

/**
 * 项目文件列表里，解析失败的文件行下方那一行：「原因：〈全文〉」；
 * 没有记录原因时「原因：系统未记录原因」；文件不是解析失败状态时不显示（null）。
 */
export function fileListParseErrorLine(
  parseStatus: string | null | undefined,
  parseError: string | null | undefined,
): string | null {
  if (parseStatus !== "failed") return null;
  return `原因：${parseError?.trim() || PARSE_ERROR_MISSING_TEXT}`;
}
