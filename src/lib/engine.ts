// Algorithm 1: the Cross-Facility Contraindication Engine.
// A deterministic rule check, so every block names the rule that caused it.
import matrix from "~/data/contraindication_rules.json";

export type EngineMedication = { drug: string; ongoing: boolean };
export type EngineRecord = {
  id?: string;
  status: string; // only ACTIVE records drive the engine
  diagnosis: string[];
  prescribed_medications: EngineMedication[];
};
export type Rule = {
  id: string;
  type: "DRUG_DIAGNOSIS_CONFLICT" | "DRUG_DRUG_CONFLICT";
  drugs: string[];
  diagnoses?: string[];
  conflicts_with?: string[];
  reason: string;
  source: { document: string; printed_page: number; statement: string };
};
export type CheckResult =
  | { allowed: true }
  | {
      allowed: false;
      ruleId: string;
      type: Rule["type"];
      drug: string;
      conflictsWith: string;
      reason: string;
      source: Rule["source"];
      /** the record in the history that carries the conflicting diagnosis or drug, if it is not in this submission */
      sourceRecordId: string | null;
    };

export const RULES = (matrix as unknown as { rules: Rule[] }).rules;

export function checkContraindications(
  history: EngineRecord[],
  proposedDrugs: string[],
  proposedDiagnoses: string[] = [],
): CheckResult {
  // Step 1: disputed records must not drive the engine.
  const active = history.filter((r) => r.status === "ACTIVE");
  const diagnoses = new Set([...active.flatMap((r) => r.diagnosis), ...proposedDiagnoses]);
  const currentDrugs = new Set(active.flatMap((r) => r.prescribed_medications.filter((m) => m.ongoing).map((m) => m.drug)));

  const recordWithDiagnosis = (d: string) => active.find((r) => r.diagnosis.includes(d))?.id ?? null;
  const recordWithDrug = (d: string) =>
    active.find((r) => r.prescribed_medications.some((m) => m.ongoing && m.drug === d))?.id ?? null;

  for (const drug of proposedDrugs) {
    // Other drugs in the same prescription count as well.
    const others = new Set([...currentDrugs, ...proposedDrugs.filter((d) => d !== drug)]);
    for (const rule of RULES) {
      if (rule.type === "DRUG_DIAGNOSIS_CONFLICT" && rule.drugs.includes(drug)) {
        const hit = (rule.diagnoses ?? []).find((d) => diagnoses.has(d));
        if (hit)
          return { allowed: false, ruleId: rule.id, type: rule.type, drug, conflictsWith: hit, reason: rule.reason, source: rule.source, sourceRecordId: recordWithDiagnosis(hit) };
      }
      if (rule.type === "DRUG_DRUG_CONFLICT") {
        // Either side of the pair may be the new drug.
        const opposite = rule.drugs.includes(drug) ? (rule.conflicts_with ?? []) : (rule.conflicts_with ?? []).includes(drug) ? rule.drugs : [];
        const hit = opposite.find((d) => others.has(d));
        if (hit)
          return { allowed: false, ruleId: rule.id, type: rule.type, drug, conflictsWith: hit, reason: rule.reason, source: rule.source, sourceRecordId: recordWithDrug(hit) };
      }
    }
  }
  return { allowed: true };
}
