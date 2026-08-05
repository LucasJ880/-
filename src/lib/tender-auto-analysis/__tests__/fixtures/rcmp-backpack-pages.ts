/**
 * 合成多页文本 fixture（非真实 PDF）——覆盖 RCMP Cadet Backpack 关键字符串。
 */

import type { PageInput } from "../../extract/types";

const DOC_ID = "doc_fixture_rcmp_backpack";

const M_LINES = [
  "M1. Minimum capacity of 35 litres with labelled volume marking.",
  "M2. Shell fabric shall be 1000D nylon or equivalent abrasion-resistant material.",
  "M3. Water resistance: fabric and seams shall resist water penetration under stated test.",
  "M4. Main zipper shall meet performance standards for strength and durability.",
  "M5. Webbing and straps shall meet tensile strength requirements.",
  "M6. Thread and stitching shall meet specified performance standards.",
  "M7. Dimensions shall be measured using the method described in Annex C.",
  "M8. Colour shall match the specified olive/black reference.",
  "M9. RCMP / Cadets marking or logo placement as specified.",
  "M10. Padded back panel and shoulder straps required.",
  "M11. External pockets/compartments as per technical drawing.",
  "M12. Buckles and fasteners shall be durable and field-replaceable where stated.",
  "M13. Maximum empty weight shall not exceed the specified limit.",
  "M14. Durability / abrasion performance evidence may be requested.",
  "M15. Sample may be required; confirm whether sample is required at bid time.",
];

export function buildRcmpBackpackFixturePages(): PageInput[] {
  return [
    {
      documentId: DOC_ID,
      pageNumber: 1,
      contentText: [
        "Royal Canadian Mounted Police (RCMP)",
        "Solicitation Number: M5000-25-3574-A",
        "Title: Backpacks for Cadets",
        "Closing: 2026-08-18 14:00 MDT",
        "This Request for Proposal invites bids for cadet backpacks.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 2,
      contentText: [
        "Procurement notes",
        "Reciprocal Procurement declaration is required.",
        "Delivery terms: DDP Regina",
        "Delivery within 30 days of call-up unless otherwise stated.",
        "Contract period: up to five (5) years as described herein.",
        "Submission: three PDFs must be submitted by email; total size under 5MB.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 3,
      contentText: [
        "ANNEX A — Basis of Payment / Estimated Quantities",
        "Up to 1500 per contract period may be ordered via call-ups.",
        "Call-up quantities may vary; minimum/maximum/typical quantities are not guaranteed.",
        "",
        "ANNEX B — Evaluation",
        "For evaluation purposes, the annual quantity is 1,500 units per year.",
        "Over a five-year evaluation horizon the aggregate evaluation quantity is 7,500.",
        "The 7,500 figure is an evaluation aggregate and is NOT a guaranteed purchase.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 4,
      contentText: [
        "Mandatory Technical Criteria",
        ...M_LINES,
        "",
        "Overseas manufacturing: bidders should confirm whether overseas manufacturing is allowed.",
        "Environmentally preferable packaging declaration may be required.",
      ].join("\n"),
    },
  ];
}

export const FIXTURE_DOC_ID = DOC_ID;
