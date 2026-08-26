/**
 * 分析师备忘录 v2 · 管线（全文深读 → 研究 → 两段综合；断点续跑）
 *
 * 时间语义：调用方给 deadline；每完成一个原子步就落一次状态（room.summaryJson.analystMemoV2）。
 * 到点未完 → 返回 inProgress（UI 自动续点，状态无损续跑）。源文档变更（指纹不符）自动作废重来。
 * 证据纪律：笔记 pageRef 必须是真实锚点；市场价两跳仍过"片段逐字可核"门；综合层只准引用输入。
 */

import { db } from "@/lib/db";
import { callStructured, createUnifiedRuntimeInvoker, type LlmInvoker } from "@/lib/tender-understanding/llm";
import {
  ANALYST_MEMO_V2_VERSION,
  EMPTY_NOTES,
  MEMO_STATE_KEY,
  chunkNotesSchema,
  chunkPages,
  groundChunkNotes,
  memoSectionsSchema,
  mergeNotes,
  type ChunkNotes,
  type MemoSections,
  type MemoV2State,
} from "./contract";
import { researchReferencedStandards, type ReferencedStandardsIntel, type StandardRef } from "@/lib/tender-intel/referenced-standards";
import { researchMarketPricingTwoHop, type MarketPricingIntel } from "@/lib/tender-intel/market-pricing";

export type MemoV2StepResult =
  | { done: false; statusZh: string; progress: { step: string; done: number; total: number } }
  | { done: true; state: MemoV2State; fullTextCorpus: string };

type Deps = { invoker?: LlmInvoker; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => number };

async function loadPages(runId: string): Promise<Array<{ docTitle: string; pageNumber: number; unitLabel: string | null; contentText: string }>> {
  const run = await db.tenderAnalysisRun.findUnique({ where: { id: runId }, select: { projectId: true } });
  if (!run) return [];
  const docs = await db.projectDocument.findMany({ where: { projectId: run.projectId }, select: { id: true, title: true }, orderBy: { createdAt: "asc" } });
  const pages = await db.projectDocumentPage.findMany({
    where: { documentId: { in: docs.map((d) => d.id) }, parseStatus: "done" },
    orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }],
    select: { documentId: true, pageNumber: true, unitLabel: true, contentText: true },
  });
  const title = new Map(docs.map((d) => [d.id, d.title]));
  const order = new Map(docs.map((d, i) => [d.id, i]));
  return pages
    .sort((a, b) => (order.get(a.documentId)! - order.get(b.documentId)!) || a.pageNumber - b.pageNumber)
    .map((p) => ({ docTitle: title.get(p.documentId) ?? "文档", pageNumber: p.pageNumber, unitLabel: p.unitLabel, contentText: p.contentText }));
}

async function loadState(projectId: string): Promise<{ roomId: string; state: MemoV2State | null }> {
  const room = await db.bidIntelligenceRoom.upsert({
    where: { projectId },
    create: { orgId: (await db.project.findUnique({ where: { id: projectId }, select: { orgId: true } }))!.orgId!, projectId },
    update: {},
    select: { id: true, summaryJson: true },
  });
  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  return { roomId: room.id, state: (sj[MEMO_STATE_KEY] as MemoV2State | undefined) ?? null };
}

async function saveState(roomId: string, state: MemoV2State): Promise<void> {
  const room = await db.bidIntelligenceRoom.findUnique({ where: { id: roomId }, select: { summaryJson: true } });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  await db.bidIntelligenceRoom.update({
    where: { id: roomId },
    data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, [MEMO_STATE_KEY]: state })) },
  });
}

const READ_SYSTEM =
  "你是资深投标分析师，正在逐段精读招标文件。从本段文本中抽取结构化阅读笔记。" +
  '只输出 JSON：{"scopeNotes":[],"specNotes":[{"item","valueRaw","pageRef"}],"commercialNotes":[{"topic","detailZh","pageRef"}],"externalRefs":[{"refCode","docName","sectionRange","quote","pageRef"}],"ambiguities":[{"questionZh","whyZh","pageRef"}],"productPhrases":[],"riskSignals":[{"riskZh","pageRef"}]}。' +
  "铁律：① pageRef 必须原样照抄文本中的【…】锚点内容；② valueRaw/quote 必须是原文摘录（数字、单位原样）；" +
  "③ externalRefs 抓「引用了外部标准/规范/通用条款但未展开原文」的引用（标准号、节号、General Conditions 条款号等）；" +
  "④ 商务笔记覆盖：交付期限、违约金、付款、保函保险、评标方式、提交方式、资格要求；⑤ 本段没有的就留空数组，绝不编。";

export async function runMemoV2Step(input: { projectId: string; runId: string; deadlineMs: number } & Deps): Promise<MemoV2StepResult> {
  const now = input.now ?? Date.now;
  const invoker = input.invoker ?? createUnifiedRuntimeInvoker();
  const timeLeft = () => input.deadlineMs - now();

  const pages = await loadPages(input.runId);
  if (pages.length === 0) throw new Error("该分析没有已解析的页级文本（请先完成标书分析）");
  const chunks = chunkPages(pages);
  const fingerprint = `${pages.length}:${pages.reduce((s, p) => s + p.contentText.length, 0)}`;
  const fullTextCorpus = chunks.map((c) => c.text).join("\n\n");

  const { roomId, state: prev } = await loadState(input.projectId);
  let state: MemoV2State =
    prev && prev.version === ANALYST_MEMO_V2_VERSION && prev.runId === input.runId && prev.sourceFingerprint === fingerprint && prev.status !== "done"
      ? prev
      : {
          version: ANALYST_MEMO_V2_VERSION,
          runId: input.runId,
          sourceFingerprint: fingerprint,
          status: "reading",
          chunks: chunks.map((c) => c.meta),
          chunksDone: 0,
          notes: EMPTY_NOTES,
          research: null,
          sectionsPart1: null,
          sectionsPart2: null,
          updatedAt: new Date().toISOString(),
        };
  // 已完成的旧态（同源）直接复用：允许"重新生成文档"不重跑深读
  if (prev && prev.version === ANALYST_MEMO_V2_VERSION && prev.runId === input.runId && prev.sourceFingerprint === fingerprint && prev.status === "done") {
    return { done: true, state: prev, fullTextCorpus };
  }

  const persist = async () => {
    state = { ...state, updatedAt: new Date().toISOString() };
    await saveState(roomId, state);
  };

  // ── Pass 1 深读（逐块） ──
  while (state.status === "reading") {
    if (state.chunksDone >= chunks.length) {
      state = { ...state, status: "researching" };
      await persist();
      break;
    }
    if (timeLeft() < 70_000) {
      await persist();
      return { done: false, statusZh: `深读中（${state.chunksDone}/${chunks.length} 块）`, progress: { step: "reading", done: state.chunksDone, total: chunks.length } };
    }
    const chunk = chunks[state.chunksDone]!;
    const res = await callStructured(
      invoker,
      // 4500：推理模型在密集条款块上会把小预算烧在推理里（实测 3200 → EMPTY_OUTPUT）
      { promptName: "tender-memo-v2-read", promptVersion: "1", timeoutMs: 120_000, maxTokens: 4500, systemPrompt: READ_SYSTEM, userPrompt: chunk.text },
      chunkNotesSchema,
    );
    if (!res.ok) throw new Error(`深读第 ${state.chunksDone + 1}/${chunks.length} 块失败：${res.errorCode}`);
    const clean: ChunkNotes = groundChunkNotes(chunk.text, res.value);
    state = { ...state, notes: mergeNotes(state.notes, clean), chunksDone: state.chunksDone + 1 };
    await persist();
  }

  // ── Pass 2 研究（M3 标准 + M4 两跳市场价） ──
  if (state.status === "researching") {
    if (timeLeft() < 120_000) {
      return { done: false, statusZh: "深读完成，待研究（标准/市场价）", progress: { step: "researching", done: 0, total: 2 } };
    }
    const refs: StandardRef[] = [];
    const seenDoc = new Set<string>();
    for (const r of state.notes.externalRefs) {
      const key = r.docName.toLowerCase().trim();
      if (seenDoc.has(key)) continue;
      seenDoc.add(key);
      refs.push({ refCode: r.refCode, docName: r.docName, sectionRange: r.sectionRange ?? null, whyRelevantZh: "全文深读识别的外部引用", sourceQuote: r.quote });
    }
    const standards: ReferencedStandardsIntel = await researchReferencedStandards({ refs: refs.slice(0, 4), env: input.env, fetchImpl: input.fetchImpl, invoker });
    const market: MarketPricingIntel = await researchMarketPricingTwoHop({
      productPhrase: state.notes.productPhrases[0] ?? null,
      specHints: state.notes.specNotes.slice(0, 8).map((s) => `${s.item} ${s.valueRaw}`),
      env: input.env,
      fetchImpl: input.fetchImpl,
      invoker,
    });
    state = { ...state, research: { standards, market }, status: "synthesizing" };
    await persist();
  }

  // ── Pass 3 综合（两段叙事） ──
  if (state.status === "synthesizing") {
    const digest = buildSynthesisDigest(state);
    if (!state.sectionsPart1) {
      if (timeLeft() < 120_000) return { done: false, statusZh: "研究完成，待综合（1/2）", progress: { step: "synthesizing", done: 0, total: 2 } };
      state = { ...state, sectionsPart1: await synthesizePart(invoker, digest, 1) };
      await persist();
    }
    if (!state.sectionsPart2) {
      if (timeLeft() < 120_000) return { done: false, statusZh: "综合中（1/2 完成）", progress: { step: "synthesizing", done: 1, total: 2 } };
      state = { ...state, sectionsPart2: await synthesizePart(invoker, digest, 2) };
      await persist();
    }
    state = { ...state, status: "done" };
    await persist();
  }

  return { done: true, state, fullTextCorpus };
}

function buildSynthesisDigest(state: MemoV2State): string {
  const n = state.notes;
  const std = state.research?.standards as ReferencedStandardsIntel | null;
  const mk = state.research?.market as MarketPricingIntel | null;
  const rows: string[] = [];
  const sec = (t: string, xs: string[]) => { if (xs.length) rows.push(`【${t}】\n${xs.map((x) => `- ${x}`).join("\n")}`); };
  sec("范围", n.scopeNotes);
  sec("规格（原文摘录+出处）", n.specNotes.map((s) => `${s.item}：${s.valueRaw}（${s.pageRef}）`));
  sec("商务条款（出处）", n.commercialNotes.map((c) => `${c.topic}：${c.detailZh}（${c.pageRef}）`));
  sec("风险信号（出处）", n.riskSignals.map((r) => `${r.riskZh}（${r.pageRef}）`));
  sec("歧义/待澄清（出处）", n.ambiguities.map((a) => `${a.questionZh}——${a.whyZh}（${a.pageRef}）`));
  if (std?.status === "ran") sec("外部标准展开（已接地检索）", std.standards.flatMap((s) => s.status === "expanded" ? s.clauses.map((c) => `${s.ref.docName} ${c.clauseId}：${c.clauseSummaryZh}｜含义：${c.implicationZh}`) : [`${s.ref.docName}：检索未找到原文（诚实缺口）`]));
  if (mk?.status === "ran") {
    sec("市场价格基准（原币，已接地）", mk.benchmarks.map((b) => `${b.productName}${b.vendor ? `（${b.vendor}）` : ""}：${b.priceRaw}${b.unit ? `/${b.unit}` : ""}——${b.comparabilityZh}`));
    if (mk.insufficientZh) rows.push(`【市场价缺口】\n- ${mk.insufficientZh}`);
  }
  return rows.join("\n\n").slice(0, 30_000);
}

const SYNTH_BASE =
  "你是投标分析师，为管理层撰写一份 GPT 风格的连贯备忘录（中文叙事+表格）。只输出 JSON：{\"sections\":[{\"titleZh\",\"bodyMd\"}]}。" +
  "bodyMd 用受限 Markdown（### 小标题、**粗体**、- 列表、| 表格 |）。" +
  "铁律：① 只准使用输入笔记/研究中的事实与数字，每个关键论断标注出处（沿用输入中的（《文档》p.X）格式）；" +
  "② 数字原样引用绝不换算；③ 输入里没有的信息明说「文件未载明」；④ 叙事要给判断（像资深分析师），但判断必须能从输入推出。";

async function synthesizePart(invoker: LlmInvoker, digest: string, part: 1 | 2): Promise<MemoSections["sections"]> {
  const spec =
    part === 1
      ? "本段写第 1–5 节：一、执行摘要（可投性一句话+两三个前提）；二、项目与采购要点（表格）；三、工作范围与交付；四、技术规格深读（含隐藏要求，尤其外部标准展开的含义）；五、商务与合同条款（交付期限/违约金/付款/保函/评标）。"
      : "本段写第 6–10 节：六、风险与对策（表格：风险/级别/对策，含交付周期这类硬风险）；七、市场价格观察（有基准引基准并给区间观察；无基准就明说缺口与补法，绝不编价）；八、GO/NO-GO 分维评级（表格：维度/🟢🟡🔴/理由/出处）；九、建议澄清问题（RFI，中英对照表格）；十、下一步行动与数据缺口。";
  const res = await callStructured(
    invoker,
    { promptName: `tender-memo-v2-synth-p${part}`, promptVersion: "1", timeoutMs: 150_000, maxTokens: 7000, systemPrompt: SYNTH_BASE + spec, userPrompt: digest },
    memoSectionsSchema,
  );
  if (!res.ok) throw new Error(`综合（第 ${part} 段）失败：${res.errorCode}`);
  return res.value.sections;
}
