/**
 * 合成多页文本 fixture（非真实 PDF）——覆盖 RCMP Cadet Backpack 关键字符串与误匹配陷阱。
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
        "REQUEST FOR STANDING OFFER Regional Individual Standing Offer (RISO)",
        "Offer to: Royal Canadian Mounted Police (RCMP)",
        "THIS DOCUMENT DOES NOT CONTAIN A SECURITY REQUIREMENT",
        "Title – Sujet Backpacks for Cadets",
        "Date July 29, 2026",
        "Solicitation No. – Nº de l’invitation M5000-25-3574-A",
        "Solicitation Closes – L’invitation prend fin At /à : 14 :00 MDT (Mountain Daylight Time) On / le : August 18, 2026",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 2,
      contentText: [
        "Reciprocal Procurement - Limited Supplier Eligibility",
        "This solicitation of offers is subject to the Policy on Reciprocal Procurement.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 4,
      contentText: [
        "The period of the Standing Offer is from October 2, 2026 to October 1, 2029, with the option to extend the Standing Offer for up to two (2) additional one (1) year periods, from October 2, 2029 to October 1, 2030, and from October 2, 2030 to October 1, 2031 under the same terms and conditions.",
        "1.4 Security Requirements There is no security requirement applicable to the Standing Offer",
        "1.3 Environmental Packaging environmentally preferable packaging specifications for this procurement",
        "1.5 Reciprocal Procurement - Limited Supplier Eligibility",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 6,
      contentText: "Offers will remain open for acceptance for a period of 90 days from the closing date.",
    },
    {
      documentId: DOC_ID,
      pageNumber: 8,
      contentText: [
        "Offer Preparation Instructions",
        "Section I: Technical Offer (one soft copy in PDF format) Section II: Financial Offer (one soft copy in PDF format) Section III: Certifications (one soft copy in PDF format)",
        "Incoming e-mail messages must not exceed 5MB. Zip files or links to Offer documents will not be accepted.",
        "Prices must appear in the financial offer only.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 12,
      contentText:
        "Offerors must meet all mandatory technical evaluation criteria to be declared responsive. The responsive offer with the lowest evaluated price will be recommended for issuance of a standing offer.",
    },
    {
      documentId: DOC_ID,
      pageNumber: 17,
      contentText:
        "Reciprocal Procurement This solicitation of offers is only open to Canadian Suppliers and to Suppliers of an Applicable Trading Partner as defined in the Annex.",
    },
    {
      documentId: DOC_ID,
      pageNumber: 23,
      contentText: [
        "TRAP: The Offeror should notify the Standing Offer Authority 30 days before the expiry date of the Standing Offer.",
        "TRAP: quarterly report within 30 calendar days after the quarter.",
        "TRAP: enquiries must be submitted five calendar days before closing.",
        "The period of the Standing Offer is from October 2, 2026 to October 1, 2029.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 27,
      contentText:
        "Forced Labour Requirement – Standing Offer 1. Offeror’s Statement. The Offeror states that the goods or services offered are not produced with forced labour.",
    },
    {
      documentId: DOC_ID,
      pageNumber: 30,
      contentText:
        "6.17.2 Delivery Date Delivery of the goods must be made in accordance with the call-up against the Standing Offer, within 30 days of call-up issuance.",
    },
    {
      documentId: DOC_ID,
      pageNumber: 31,
      contentText:
        "Goods must be consigned Delivered Duty Paid (DDP) Regina, Saskatchewan Incoterms 2020 for shipments from a commercial contractor.",
    },
    {
      documentId: DOC_ID,
      pageNumber: 33,
      contentText: [
        "ANNEX A — Statement of Requirement",
        "Required quantity: Up to 1500 per contract period",
        "Mandatory Technical Criteria",
        ...M_LINES,
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 34,
      contentText: [
        "Upon receipt of a call-up, the Offeror must: 1 Confirm the order by email within 24 hours to the Project Authority",
        "Delivery of the goods must be made within 30 days of call-up issuance.",
        "9. ENVIRONMENTALLY PREFERABLE PACKAGING – MANDATORY",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 36,
      contentText: [
        "ANNEX B — Basis of Payment",
        "Standing Offer Year 1: (dates to be inserted at issuance of the Standing offer) Each 1500 $ $",
        "Standing Offer Year 2: (dates to be inserted at issuance of the Standing offer) Each 1500 $ $",
        "Standing Offer Year 3: (dates to be inserted at issuance of the Standing offer) Each 1500 $ $",
        "The estimated quantity is provided for evaluation purposes only and does not constitute a guarantee or commitment on behalf of Canada.",
        "DDP) Regina Incoterms 2020 for shipments from a commercial Contractor.",
      ].join("\n"),
    },
    {
      documentId: DOC_ID,
      pageNumber: 37,
      contentText: [
        "Option Year 1: (dates to be inserted at issuance of the Standing offer) Each 1500 $ $",
        "Option Year 2: (dates to be inserted at issuance of the Standing offer) Each 1500 $ $",
      ].join("\n"),
    },
  ];
}

export const FIXTURE_DOC_ID = DOC_ID;
