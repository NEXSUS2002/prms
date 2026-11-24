// Investigations offered for the common laboratory departments. A hospital may name a department that is
// not listed here; the ordering form then takes the investigation as free text.
export type LabTest = { name: string; specimen: string };

const CATALOGUE: Record<string, LabTest[]> = {
  haematology: [
    { name: "Full blood count", specimen: "Venous blood, EDTA bottle" },
    { name: "Malaria parasite, thick and thin film", specimen: "Venous or capillary blood" },
    { name: "Haemoglobin genotype", specimen: "Venous blood, EDTA bottle" },
    { name: "Erythrocyte sedimentation rate", specimen: "Venous blood, citrate bottle" },
  ],
  radiology: [
    { name: "Chest X-ray, PA view", specimen: "Not applicable (imaging)" },
    { name: "Abdominal ultrasound", specimen: "Not applicable (imaging); fasting for 6 hours" },
    { name: "Pelvic ultrasound", specimen: "Not applicable (imaging); full bladder" },
  ],
  "chemical pathology": [
    { name: "Fasting blood glucose", specimen: "Venous blood, fluoride oxalate bottle" },
    { name: "Electrolytes, urea and creatinine", specimen: "Venous blood, lithium heparin bottle" },
    { name: "Liver function tests", specimen: "Venous blood, plain bottle" },
    { name: "Lipid profile", specimen: "Venous blood, plain bottle; fasting" },
  ],
  "medical microbiology": [
    { name: "Urine microscopy, culture and sensitivity", specimen: "Mid-stream urine, sterile bottle" },
    { name: "Sputum GeneXpert MTB/RIF", specimen: "Sputum, early morning" },
    { name: "Blood culture", specimen: "Venous blood, culture bottles" },
  ],
  histopathology: [{ name: "Tissue biopsy histology", specimen: "Tissue in 10% formalin" }],
  "blood bank": [{ name: "Blood group and cross-match", specimen: "Venous blood, EDTA and plain bottles" }],
};

/** Departments whose reports take days get a 14-day token; the rest get 24 hours (Algorithm 4). */
const LONG_VALIDITY = ["radiology", "histopathology"];

export const testsFor = (departmentName: string): LabTest[] => CATALOGUE[departmentName.trim().toLowerCase()] ?? [];
export const tokenHoursFor = (departmentName: string): number => (LONG_VALIDITY.includes(departmentName.trim().toLowerCase()) ? 14 * 24 : 24);
export const tokenValidityLabel = (departmentName: string): string => (tokenHoursFor(departmentName) === 24 ? "24 hours" : "14 days");
