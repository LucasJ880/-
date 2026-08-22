/**
 * Autopilot A2-P2.1 — deterministic requirement / packet sufficiency.
 *
 * READY means structurally valid evidence exists.
 * READY / SUFFICIENT are structural, not semantic task outcomes.
 */

import {
  hasEvaluatableRequirements,
  type ValidatedTaskContract,
} from "./a2p2-contract";
import { canonicalJson } from "./a2p2-evidence-hash";
import {
  MAX_FACTS_PER_REQUIREMENT,
  type EvidenceFact,
  type EvidencePacketStatus,
  type EvidenceReasonCode,
  type RequirementEvidenceAssessment,
} from "./a2p2-evidence-types";

export function assessRequirementEvidence(
  contract: ValidatedTaskContract,
  facts: readonly EvidenceFact[],
): {
  assessments: RequirementEvidenceAssessment[];
  packetLimitExceeded: boolean;
} {
  let packetLimitExceeded = false;
  const assessments: RequirementEvidenceAssessment[] = contract.requirements.map(
    (requirement) => {
      const related = facts.filter((fact) => fact.requirementId === requirement.id);
      const privacyBlocked = related.some(
        (fact) => fact.privacyClass === "PROHIBITED" || fact.acceptance === "BLOCKED",
      );
      if (privacyBlocked && requirement.required) {
        return {
          requirementId: requirement.id,
          requiredEvidenceRefs: requirement.minimumEvidenceRefs,
          validEvidenceRefs: [],
          state: "PRIVACY_BLOCKED",
          reasonCode: "EVIDENCE_PRIVACY_BLOCKED",
        };
      }
      const counting = related.filter((fact) => fact.countsTowardRequirement);
      const uniqueRefs = [...new Set(counting.map((fact) => fact.evidenceRef))];
      if (uniqueRefs.length > MAX_FACTS_PER_REQUIREMENT) {
        packetLimitExceeded = true;
        return {
          requirementId: requirement.id,
          requiredEvidenceRefs: requirement.minimumEvidenceRefs,
          validEvidenceRefs: uniqueRefs.slice(0, MAX_FACTS_PER_REQUIREMENT),
          state: "NOT_EVALUABLE",
          reasonCode: "EVIDENCE_PACKET_LIMIT_EXCEEDED",
        };
      }
      const byKey = new Map<string, Set<string>>();
      for (const fact of counting) {
        const key = fact.factKey;
        const value = canonicalJson(fact.normalizedValue);
        const set = byKey.get(key) ?? new Set<string>();
        set.add(value);
        byKey.set(key, set);
      }
      const conflicting = [...byKey.values()].some((values) => values.size > 1);
      if (conflicting) {
        return {
          requirementId: requirement.id,
          requiredEvidenceRefs: requirement.minimumEvidenceRefs,
          validEvidenceRefs: uniqueRefs,
          state: "CONFLICTING",
          reasonCode: "EVIDENCE_STRUCTURAL_CONFLICT",
        };
      }
      if (uniqueRefs.length >= requirement.minimumEvidenceRefs) {
        return {
          requirementId: requirement.id,
          requiredEvidenceRefs: requirement.minimumEvidenceRefs,
          validEvidenceRefs: uniqueRefs,
          state: "READY",
          reasonCode: "EVIDENCE_READY",
        };
      }
      if (!requirement.required && requirement.allowUnknown && uniqueRefs.length === 0) {
        return {
          requirementId: requirement.id,
          requiredEvidenceRefs: requirement.minimumEvidenceRefs,
          validEvidenceRefs: uniqueRefs,
          state: "READY",
          reasonCode: "EVIDENCE_READY",
        };
      }
      return {
        requirementId: requirement.id,
        requiredEvidenceRefs: requirement.minimumEvidenceRefs,
        validEvidenceRefs: uniqueRefs,
        state: "INSUFFICIENT",
        reasonCode: "EVIDENCE_MISSING",
      };
    },
  );
  return { assessments, packetLimitExceeded };
}

export function assessPacketStatus(input: {
  contract: ValidatedTaskContract;
  assessments: readonly RequirementEvidenceAssessment[];
  privacyBlocked: boolean;
  packetLimitExceeded: boolean;
  extraDiagnostics?: readonly EvidenceReasonCode[];
}): EvidencePacketStatus {
  if (input.privacyBlocked) return "PRIVACY_BLOCKED";
  if (input.packetLimitExceeded) return "NOT_EVALUABLE";
  if (!hasEvaluatableRequirements(input.contract)) return "NOT_EVALUABLE";
  const required = input.assessments.filter((item) =>
    input.contract.requirements.some((req) => req.id === item.requirementId && req.required),
  );
  if (required.some((item) => item.state === "PRIVACY_BLOCKED")) return "PRIVACY_BLOCKED";
  if (required.some((item) => item.state === "CONFLICTING")) return "CONFLICTING";
  if (required.some((item) => item.state === "INSUFFICIENT" || item.state === "NOT_EVALUABLE")) {
    return "INSUFFICIENT";
  }
  if (required.every((item) => item.state === "READY")) return "SUFFICIENT";
  return "INSUFFICIENT";
}
