# PRMS test scenarios

59 test cases covering FR1–FR13 and the role boundaries. Every case uses the seeded data in `data/`.
All accounts use the password `Prms@Demo2026`. Emails are in `data/users.json`.

## Who is who

| Account | Role | Hospital |
|---|---|---|
| Dr Oluwaseun Adebayo | Doctor | A (Ibadan) |
| Dr Chiamaka Okafor | Doctor (emergency) | A |
| Dr Aminu Bello | Doctor | B (Lagos) |
| Dr Tari Douglas | Doctor, **not verified on the contract** | B |
| Nurse Funmilayo Ojo | Nurse | A |
| Nurse Rahila Danjuma | Nurse | B |
| Ifeanyi Uche | Lab technician, Haematology | A |
| Zainab Lawal | Lab technician, Radiology | A |
| Dr Ngozi Umeh | Doctor, **not yet verified** | A |
| Kemi Afolabi | Hospital admin | A |
| Tolu Bankole | Hospital admin | B |
| Ibrahim Danladi | Platform registrar | — |

Six more hospitals (C to H) each have one admin, one doctor, one nurse and one lab technician; see `data/staff_affiliations.json`.

## FR1 — Consent (patient: Emeka Nwosu, `pat_08`)

| ID | Steps | Expected |
|---|---|---|
| TC-FR1-01 | Dr Okafor searches for Emeka Nwosu and requests access | History stays hidden; a PENDING row is written to `access_grants`; Emeka now sees two requests waiting (the seeded one from Dr Adebayo and this one) |
| TC-FR1-02 | Emeka approves Dr Adebayo's request in MetaMask | Grant recorded on the contract; the row becomes GRANTED with a 24-hour expiry and moves to "active access" |
| TC-FR1-03 | Dr Adebayo opens the record | Timeline of 5 records is returned |
| TC-FR1-04 | Emeka revokes; Dr Adebayo reloads the record | Access refused; revocation appears in the audit log |
| TC-FR1-05 | Emeka declines Dr Okafor's request; Dr Okafor reloads | Request closed without a transaction; history stays hidden |
| TC-FR1-06 | Emeka opens "Who can read my record" | Dr Bello listed under active access; the 2024 grant to Dr Adebayo and the revoked grant to Dr Bello listed under past access, each with its hospital |

## FR2 — Glass-Break (patient: Musa Ibrahim, `pat_04`, no consent given)

| ID | Steps | Expected |
|---|---|---|
| TC-FR2-01 | Dr Okafor clicks Emergency Override and signs | `EmergencyAccessLogged` emitted; record opens, showing the penicillin allergy and carbamazepine |
| TC-FR2-02 | Dr Douglas (unverified) attempts the override | Transaction reverts with "Unauthorised practitioner"; no access |
| TC-FR2-03 | Musa logs in and opens the audit log | Override listed with Dr Okafor's licence number and the time |
| TC-FR2-04 | Dr Okafor reloads after the one-hour window (shorten the window in a test build) | Access refused |

## FR3 — Contraindication Engine

These 13 cases are also in `data/prescription_test_cases.json`, so they can be run as automated unit tests.

| ID | Patient | Prescribed | Expected | Rule |
|---|---|---|---|---|
| TC-FR3-01 | Adaeze Okonkwo (asthma recorded at Hospital A) | Propranolol, by Dr Bello at Hospital B | BLOCK | CR01 |
| TC-FR3-02 | Tunde Bakare (on lisinopril) | Losartan | BLOCK | CR16 |
| TC-FR3-03 | Ngozi Eze (clean history) | Artemether + lumefantrine, paracetamol | ALLOW | — |
| TC-FR3-04 | Halima Yusuf (pregnant) | Lisinopril | BLOCK | CR04 |
| TC-FR3-05 | Halima Yusuf (pregnant) | Nifedipine | ALLOW | — |
| TC-FR3-06 | Folake Adeyemi (ulcer diagnosis active) | Ibuprofen | BLOCK | CR03 |
| TC-FR3-07 | Folake Adeyemi, **after TC-FR4-01** | Ibuprofen | ALLOW | — |
| TC-FR3-08 | Blessing Etim (sickle cell disease) | Acetazolamide | BLOCK | CR14 |
| TC-FR3-09 | Kabiru Sani (on dolutegravir) | Rifampicin | BLOCK | CR18 |
| TC-FR3-10 | Kabiru Sani (chronic kidney disease) | Metformin | BLOCK | CR11 |
| TC-FR3-11 | Ngozi Eze, new diagnosis "peptic ulcer disease" entered in the same form | Diclofenac | BLOCK | CR03 |
| TC-FR3-12 | Musa Ibrahim (on carbamazepine) | Dolutegravir | BLOCK | CR18 |
| TC-FR3-13 | Emeka Nwosu | Ciprofloxacin | ALLOW | — |

TC-FR3-01 is the cross-facility case. TC-FR3-06 and TC-FR3-07 together show that a disputed record stops driving the engine.

## FR4 — Immutable Addendum (patient: Folake Adeyemi, `pat_05`)

| ID | Steps | Expected |
|---|---|---|
| TC-FR4-01 | Dr Bello disputes `rec_0011` (peptic ulcer disease) with corrected diagnosis "Gastro-oesophageal reflux disease" | New record created with `contradicts_record_id = rec_0011`; `rec_0011` becomes DISPUTED; dispute row written; hash anchored |
| TC-FR4-02 | Send `DELETE` for `rec_0011` to the API | Refused (404 or 405); record still present |
| TC-FR4-03 | Open Folake's timeline | Original shown with the red DISPUTED banner, nested with the correction |

## FR5 and FR6 — Laboratory workflow

| ID | Steps | Expected |
|---|---|---|
| TC-FR5-01 | Dr Adebayo orders a full blood count and a chest X-ray for Chinedu Obi | One parent requisition, two child tokens (Haematology 24 h, Radiology 14 days), both hashes registered on the contract |
| TC-FR6-01 | Ifeanyi Uche (Haematology) opens the work queue | Sees `lrq_0001` and `lrq_0005`, plus `lrq_0004` marked expired; does **not** see `lrq_0002` (Radiology) |
| TC-FR6-02 | Ifeanyi uploads a result to `lrq_0001` | Accepted; anchored; status FULFILLED; removed from queue |
| TC-FR6-03 | Ifeanyi submits to `lrq_0001` again | Rejected: token already used |
| TC-FR6-04 | Ifeanyi submits to `lrq_0004` (expired 72 h before seeding) | Rejected: token expired |
| TC-FR6-05 | Ifeanyi submits to `lrq_0002` using the Haematology session | Rejected: wrong department |
| TC-FR6-06 | Ifeanyi requests Chinedu Obi's timeline through the API | Refused (403) |
| TC-FR6-07 | Dr Adebayo opens the uploaded result | Result visible to the ordering physician |

## FR7 — Nursing (patient: Halima Yusuf, `pat_07`)

| ID | Steps | Expected |
|---|---|---|
| TC-FR7-01 | Nurse Ojo records a new set of vitals | Observation saved under her name and shown in the timeline |
| TC-FR7-02 | Nurse Ojo calls the prescription endpoint | Refused (403) |
| TC-FR7-03 | Nurse Ojo calls the dispute endpoint | Refused (403) |
| TC-FR7-04 | Nurse Ojo opens the ward list; Nurse Danjuma (Hospital B) then requests Halima Yusuf's care summary | Ojo sees the three patients admitted to the Medical Ward (beds 02, 04, 07) and nobody else; Danjuma is refused, because Halima is not admitted to her ward |

## FR8 — Unified timeline (patient: Emeka Nwosu, `pat_08`)

| ID | Steps | Expected |
|---|---|---|
| TC-FR8-01 | Emeka opens his dashboard | 5 records from both hospitals in date order |
| TC-FR8-02 | Look at the May 2024 typhoid record (`rec_0019`) | Flagged DISPUTED and nested with the October 2024 addendum (`rec_0021`) |

## FR9 — Admitting a hospital (registrar: Ibrahim Danladi)

| ID | Steps | Expected |
|---|---|---|
| TC-FR9-01 | The registrar approves application `HSP-APP-0009` (Lakeside District Hospital) and signs | Hospital recorded on the contract with its admin wallet; listed as active; its administrator can sign in |
| TC-FR9-02 | The registrar approves `HSP-APP-0010`, whose admin wallet is already bound to Harmattan Specialist Hospital | Rejected by the contract; application stays unapproved |
| TC-FR9-03 | The registrar account requests a hospital's staff list, then a patient timeline, through the API | Both refused (403) |

## FR10 — Hospital administration (admin of Hospital A: Kemi Afolabi)

| ID | Steps | Expected |
|---|---|---|
| TC-FR10-01 | Dr Ngozi Umeh (not yet verified) attempts the emergency override | Transaction reverts |
| TC-FR10-02 | Kemi Afolabi verifies Dr Ngozi Umeh and signs | Practitioner registered on the contract; status shows Verified |
| TC-FR10-03 | Dr Ngozi Umeh repeats the emergency override | Succeeds and is logged |
| TC-FR10-04 | Kemi Afolabi opens the staff list | Only Hospital A affiliations are listed, including visiting Dr Aminu Bello; nobody from the other seven hospitals |
| TC-FR10-05 | Kemi Afolabi tries to verify Dr Tari Douglas, who belongs to Hospital B | Refused: she is not that hospital's administrator |
| TC-FR10-06 | Kemi Afolabi suspends Zainab Lawal; Zainab then uploads to `lrq_0002`; Kemi re-verifies her | Upload refused while suspended; accepted again after re-verification |
| TC-FR10-07 | Kemi Afolabi requests a patient timeline through the API | Refused (403) |

## FR11 — Routing a laboratory order to a hospital (Dr Aminu Bello, working at Hospital B)

| ID | Steps | Expected |
|---|---|---|
| TC-FR11-01 | Dr Bello opens the order form | Lists his own hospital and the five others that accept outside requisitions; Aso Valley District and Ancient City Specialist are not listed |
| TC-FR11-02 | Dr Bello sends a full blood count for Emeka Nwosu to Oke-Ado Teaching Hospital | Appears in Ifeanyi Uche's queue at Hospital A; not in any other hospital's queue |
| TC-FR11-03 | An API call addresses a requisition to Aso Valley District Hospital from another hospital | Rejected |

## FR12 — Working hospital (Dr Aminu Bello, affiliated with Hospitals A and B)

| ID | Steps | Expected |
|---|---|---|
| TC-FR12-01 | Dr Bello switches "Working at" to Oke-Ado Teaching Hospital and saves an entry | The new record carries `hospital_id = hosp_a` |
| TC-FR12-02 | Dr Oluwaseun Adebayo, who has one affiliation, signs in | Only one hospital is offered |

## FR13 — Departments defined by the hospital (admin of Hospital A: Kemi Afolabi)

Hospital A is seeded with four laboratory departments (Haematology, Radiology, Chemical Pathology, Medical Microbiology), four clinical departments and one ward. Other hospitals have different sets; see `data/departments.json`.

| ID | Steps | Expected |
|---|---|---|
| TC-FR13-01 | Kemi Afolabi adds a laboratory department "Histopathology" on the hospital profile | A row is written to `departments` for `hosp_a` with type LABORATORY and sharing off; it appears in the department list and in the "Add practitioner" form |
| TC-FR13-02 | Dr Bello (Hospital B) opens the order form and chooses Oke-Ado Teaching Hospital | Haematology, Radiology and Medical Microbiology are offered; Chemical Pathology and the new Histopathology are not, because they take the hospital's own patients only |
| TC-FR13-03 | Kemi Afolabi turns on sharing for Chemical Pathology; Dr Bello reloads the order form | Chemical Pathology is now offered |
| TC-FR13-04 | Kemi Afolabi calls the API to add a department to Hospital B, then requests the list of hospitals on the network | Both refused (403): she administers one hospital, and the network list belongs to the registrar |

## Coverage

| Requirement | Cases |
|---|---|
| FR1 Consent | 6 |
| FR2 Glass-Break | 4 |
| FR3 Contraindication Engine | 13 |
| FR4 Immutable Addendum | 3 |
| FR5, FR6 Laboratory | 8 |
| FR7 Nursing | 4 |
| FR8 Timeline | 2 |
| FR9 Admitting a hospital | 3 |
| FR10 Hospital administration | 7 |
| FR11 Laboratory routing | 3 |
| FR12 Working hospital | 2 |
| FR13 Departments | 4 |
| **Total** | **59** |
