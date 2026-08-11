/**
 * tender-eval/v1 case 注册表
 *
 * 排序即报告展示顺序：过拟合对照 → 真实原件 → 业务域泛化。
 */

import type { CaseModule } from "../contract";

import { caseA0RcmpFixture } from "./case-a0-rcmp-fixture";
import { caseARcmpRisoReal } from "./case-a-rcmp-riso-real";
import { caseBDsbnWindowCoverings } from "./case-b-dsbn-window-coverings";

export const TENDER_EVAL_CASES: CaseModule[] = [
  caseA0RcmpFixture,
  caseARcmpRisoReal,
  caseBDsbnWindowCoverings,
];
