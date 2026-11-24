import drugs from "~/data/drug_catalogue.json";
import diagnoses from "~/data/diagnosis_catalogue.json";

export type CatalogueItem = { id: string; name: string };
export const DRUGS: CatalogueItem[] = (drugs as Array<{ id: string; name: string }>).map((d) => ({ id: d.id, name: d.name }));
export const DIAGNOSES: CatalogueItem[] = diagnoses as CatalogueItem[];

const drugNames = new Map(DRUGS.map((d) => [d.id, d.name]));
const dxNames = new Map(DIAGNOSES.map((d) => [d.id, d.name]));
export const drugName = (id: string) => drugNames.get(id) ?? id;
export const diagnosisName = (id: string) => dxNames.get(id) ?? id;
export const isDrug = (id: string) => drugNames.has(id);
export const isDiagnosis = (id: string) => dxNames.has(id);
