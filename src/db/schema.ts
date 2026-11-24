import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------------------------------------------------------------- accounts (Better Auth owns these four tables)
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  // PRMS fields
  role: text("role").notNull().default("patient"), // patient | doctor | nurse | lab_technician | hospital_admin | registrar
  medicalLicenseNo: text("medical_license_no"),
  publicKey: text("public_key"), // wallet address, lower case
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
});

// Better Auth keeps the password hash here (provider "credential"), not in the users table.
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- network registry
export const hospitals = pgTable("hospitals", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(), // HSP-0001
  name: text("name").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  level: text("level").notNull(), // primary | secondary | tertiary
  facilityRegistrationNo: text("facility_registration_no").notNull(),
  adminUserId: text("admin_user_id").references(() => users.id),
  adminWallet: text("admin_wallet"),
  registeredTx: text("registered_tx"),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | SUSPENDED
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const hospitalApplications = pgTable("hospital_applications", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull().unique(), // HSP-APP-0009
  name: text("name").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  level: text("level").notNull(),
  facilityRegistrationNo: text("facility_registration_no").notNull(),
  departments: jsonb("departments").$type<string[]>().notNull().default([]), // laboratory departments declared
  adminName: text("admin_name").notNull(),
  adminEmail: text("admin_email").notNull(),
  adminWallet: text("admin_wallet").notNull(),
  adminPasswordHash: text("admin_password_hash").notNull(),
  status: text("status").notNull().default("AWAITING_REVIEW"), // AWAITING_REVIEW | APPROVED | REJECTED
  decisionNote: text("decision_note"),
  hospitalId: text("hospital_id").references(() => hospitals.id),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
});

export const departments = pgTable(
  "departments",
  {
    id: text("id").primaryKey(),
    hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
    name: text("name").notNull(),
    type: text("type").notNull(), // LABORATORY | CLINICAL | WARD
    acceptsOutsideRequisitions: boolean("accepts_outside_requisitions"), // laboratory departments only
    status: text("status").notNull().default("ACTIVE"),
  },
  (t) => [uniqueIndex("departments_hospital_name").on(t.hospitalId, t.name)],
);

export const staffAffiliations = pgTable(
  "staff_affiliations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
    departmentId: text("department_id").references(() => departments.id),
    position: text("position"),
    verifiedTx: text("verified_tx"),
    status: text("status").notNull().default("PENDING_VERIFICATION"), // PENDING_VERIFICATION | ACTIVE | SUSPENDED
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("affiliations_user_hospital").on(t.userId, t.hospitalId)],
);

// ---------------------------------------------------------------- patients, access, admissions
export const patients = pgTable("patients", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  code: text("code").notNull().unique(), // PT-0001, the identifier shown on screen
  globalHealthHash: text("global_health_hash").notNull(),
  dateOfBirth: text("date_of_birth").notNull(), // YYYY-MM-DD
  sex: text("sex").notNull(),
  bloodGroup: text("blood_group"),
  genotype: text("genotype"),
});

export const accessGrants = pgTable("access_grants", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  practitionerId: text("practitioner_id").notNull().references(() => users.id),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
  grantType: text("grant_type").notNull().default("CONSENT"), // CONSENT | EMERGENCY
  status: text("status").notNull().default("PENDING"), // PENDING | GRANTED | DECLINED | REVOKED | EXPIRED
  requestedAt: ts("requested_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
  expiresAt: ts("expires_at"),
  txHash: text("tx_hash"),
  revokeTxHash: text("revoke_tx_hash"),
});

export const admissions = pgTable("admissions", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
  departmentId: text("department_id").notNull().references(() => departments.id), // a ward
  bed: text("bed"),
  reason: text("reason"),
  admittedBy: text("admitted_by").notNull().references(() => users.id),
  admittedAt: ts("admitted_at").notNull().defaultNow(),
  dischargedAt: ts("discharged_at"),
  status: text("status").notNull().default("ADMITTED"), // ADMITTED | DISCHARGED
});

// ---------------------------------------------------------------- clinical records
export type Medication = { drug: string; dose: string; frequency: string; duration: string; ongoing: boolean };
export type Vitals = {
  temperature_c: number | null;
  pulse_bpm: number | null;
  respiratory_rate: number | null;
  blood_pressure: string | null;
  spo2_percent: number | null;
};

export const clinicalRecords = pgTable("clinical_records", {
  id: text("id").primaryKey(),
  seq: serial("seq").notNull(), // insertion order; fixes the order of each patient's hash chain
  patientId: text("patient_id").notNull().references(() => patients.id),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id),
  authorId: text("author_id").notNull().references(() => users.id),
  recordType: text("record_type").notNull(), // consultation | observation | addendum
  diagnosis: jsonb("diagnosis").$type<string[]>().notNull().default([]),
  prescribedMedications: jsonb("prescribed_medications").$type<Medication[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  vitals: jsonb("vitals").$type<Vitals | null>(),
  timestamp: ts("timestamp").notNull().defaultNow(),
  previousRecordHash: text("previous_record_hash").notNull(),
  recordHash: text("record_hash").notNull(),
  contradictsRecordId: text("contradicts_record_id"),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | DISPUTED
});

export const disputes = pgTable("disputes", {
  id: text("id").primaryKey(),
  originalRecordId: text("original_record_id").notNull().references(() => clinicalRecords.id),
  newAddendumId: text("new_addendum_id").notNull().references(() => clinicalRecords.id),
  practitionerId: text("practitioner_id").notNull().references(() => users.id),
  txHash: text("tx_hash"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- laboratory
export const labRequests = pgTable("lab_requests", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(), // LRQ-0001
  parentRequisitionId: text("parent_requisition_id").notNull(),
  patientId: text("patient_id").notNull().references(() => patients.id),
  orderingPhysicianId: text("ordering_physician_id").notNull().references(() => users.id),
  orderingHospitalId: text("ordering_hospital_id").notNull().references(() => hospitals.id),
  targetHospitalId: text("target_hospital_id").notNull().references(() => hospitals.id),
  departmentId: text("department_id").notNull().references(() => departments.id),
  investigation: text("investigation").notNull(),
  specimen: text("specimen"),
  clinicalIndication: text("clinical_indication"),
  orderedAt: ts("ordered_at").notNull().defaultNow(),
  tokenSecret: text("token_secret").notNull(), // delivered only to technicians of the receiving department
  childTokenHash: text("child_token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("PENDING"), // PENDING | FULFILLED
});

export const labResults = pgTable("lab_results", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().unique().references(() => labRequests.id),
  technicianId: text("technician_id").notNull().references(() => users.id),
  resultPayload: text("result_payload").notNull(), // AES-256-GCM ciphertext, keyed to the ordering physician
  resultHash: text("result_hash").notNull(),
  txHash: text("tx_hash"),
  uploadedAt: ts("uploaded_at").notNull().defaultNow(),
});

// Simple counters for the human-readable codes (PT-0001, LRQ-0001, HSP-APP-0001).
export const counters = pgTable("counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
});
