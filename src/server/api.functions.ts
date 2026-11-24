// Every call the browser can make. Each one runs on the server, identifies the signed-in user and
// passes to the service layer, where the role and consent checks live.
import { createServerFn } from "@tanstack/react-start";
import * as account from "./account.server";
import * as consent from "./consent.server";
import * as lab from "./lab.server";
import * as records from "./records.server";
import * as registry from "./registry.server";
import { publicChainConfig } from "./chain.server";
import { rememberWorkingHospital, run, runPublic } from "./session.server";
import { loadActor } from "./actor.server";
import { forbidden } from "./util.server";
import type { EntryInput, ObservationInput } from "./records.server";
import type { RequisitionInput, ResultInput } from "./lab.server";
import type { ApplicationInput, StaffInput } from "./registry.server";

// ---------------------------------------------------------------- session
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  // One session check: run() fails with 401 when nobody is signed in, which simply means "no one".
  const res = await run(async (a) => account.describeActor(a));
  return { me: res.ok ? res.data : null, chain: publicChainConfig() };
});

export const setWorkingHospital = createServerFn({ method: "POST" })
  .validator((d: { hospitalId: string }) => d)
  .handler(({ data }) =>
    run(async (a) => {
      if (!a.affiliations.some((x) => x.hospitalId === data.hospitalId)) throw forbidden("You are not affiliated with that hospital.");
      rememberWorkingHospital(data.hospitalId);
      return account.describeActor(await loadActor(a.userId, data.hospitalId));
    }),
  );

export const completePatientProfile = createServerFn({ method: "POST" })
  .validator((d: { dateOfBirth: string; sex: string; bloodGroup?: string; genotype?: string }) => d)
  .handler(({ data }) => run((a) => account.completePatientProfile(a, data)));

export const bindWallet = createServerFn({ method: "POST" })
  .validator((d: { address: string; signature: string }) => d)
  .handler(({ data }) => run((a) => account.bindWallet(a, data)));

export const getCatalogues = createServerFn({ method: "GET" }).handler(() => runPublic(async () => account.catalogues()));

// ---------------------------------------------------------------- patient
export const getMyTimeline = createServerFn({ method: "GET" }).handler(() =>
  run((a) => {
    if (!a.patientId) throw forbidden("Complete your patient registration first.");
    return records.getTimeline(a, a.patientId);
  }),
);
export const listAccess = createServerFn({ method: "GET" }).handler(() => run((a) => consent.listAccess(a)));
export const confirmGrant = createServerFn({ method: "POST" })
  .validator((d: { grantId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => consent.confirmGrant(a, data.grantId, data.txHash)));
export const declineRequest = createServerFn({ method: "POST" })
  .validator((d: { grantId: string }) => d)
  .handler(({ data }) => run((a) => consent.declineRequest(a, data.grantId)));
export const confirmRevoke = createServerFn({ method: "POST" })
  .validator((d: { grantId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => consent.confirmRevoke(a, data.grantId, data.txHash)));
export const getAuditLog = createServerFn({ method: "GET" }).handler(() => run((a) => consent.auditLog(a)));

// ---------------------------------------------------------------- doctor
export const searchPatients = createServerFn({ method: "GET" })
  .validator((d: { query: string }) => d)
  .handler(({ data }) => run((a) => consent.searchPatients(a, data.query)));
export const requestAccess = createServerFn({ method: "POST" })
  .validator((d: { patientId: string }) => d)
  .handler(({ data }) => run((a) => consent.requestAccess(a, data.patientId)));
export const confirmEmergencyAccess = createServerFn({ method: "POST" })
  .validator((d: { patientId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => consent.confirmEmergencyAccess(a, data.patientId, data.txHash)));
export const getPatientTimeline = createServerFn({ method: "GET" })
  .validator((d: { patientId: string }) => d)
  .handler(({ data }) => run((a) => records.getTimeline(a, data.patientId)));
export const getEntryContext = createServerFn({ method: "GET" })
  .validator((d: { patientId: string }) => d)
  .handler(({ data }) => run((a) => records.entryContext(a, data.patientId)));
export const checkPrescription = createServerFn({ method: "POST" })
  .validator((d: { patientId: string; entry: EntryInput }) => d)
  .handler(({ data }) => run((a) => records.checkPrescription(a, data.patientId, data.entry)));
export const createEntry = createServerFn({ method: "POST" })
  .validator((d: { patientId: string; entry: EntryInput }) => d)
  .handler(({ data }) => run((a) => records.createEntry(a, data.patientId, data.entry)));
export const disputeRecord = createServerFn({ method: "POST" })
  .validator((d: { recordId: string; correctedDiagnoses: string[]; notes: string }) => d)
  .handler(({ data }) => run((a) => records.disputeRecord(a, data.recordId, data)));
export const dischargePatient = createServerFn({ method: "POST" })
  .validator((d: { admissionId: string }) => d)
  .handler(({ data }) => run((a) => records.dischargePatient(a, data.admissionId)));
export const getLabDestinations = createServerFn({ method: "GET" }).handler(() => run((a) => lab.labDestinations(a)));
export const createRequisition = createServerFn({ method: "POST" })
  .validator((d: { patientId: string; requisition: RequisitionInput }) => d)
  .handler(({ data }) => run((a) => lab.createRequisition(a, data.patientId, data.requisition)));
export const getDoctorOrders = createServerFn({ method: "GET" }).handler(() => run((a) => lab.doctorOrders(a)));

// ---------------------------------------------------------------- nurse (and a doctor's own observations)
export const getWardList = createServerFn({ method: "GET" }).handler(() => run((a) => records.wardList(a)));
export const getCareSummary = createServerFn({ method: "GET" })
  .validator((d: { patientId: string }) => d)
  .handler(({ data }) => run((a) => records.careSummary(a, data.patientId)));
export const recordObservation = createServerFn({ method: "POST" })
  .validator((d: { patientId: string; observation: ObservationInput }) => d)
  .handler(({ data }) => run((a) => records.recordObservation(a, data.patientId, data.observation)));

// ---------------------------------------------------------------- laboratory technician
export const getLabQueue = createServerFn({ method: "GET" }).handler(() => run((a) => lab.labQueue(a)));
export const getLabRequest = createServerFn({ method: "GET" })
  .validator((d: { requestId: string }) => d)
  .handler(({ data }) => run((a) => lab.labRequestForUpload(a, data.requestId)));
export const uploadResult = createServerFn({ method: "POST" })
  .validator((d: { requestId: string; upload: ResultInput }) => d)
  .handler(({ data }) => run((a) => lab.uploadResult(a, data.requestId, data.upload)));
export const getLabHistory = createServerFn({ method: "GET" }).handler(() => run((a) => lab.labHistory(a)));

// ---------------------------------------------------------------- hospital administrator
export const listStaff = createServerFn({ method: "GET" }).handler(() => run((a) => registry.listStaff(a)));
export const getStaffFormOptions = createServerFn({ method: "GET" }).handler(() => run((a) => registry.staffFormOptions(a)));
export const addStaff = createServerFn({ method: "POST" })
  .validator((d: StaffInput) => d)
  .handler(({ data }) => run((a) => registry.addStaff(a, data)));
export const getStaffTxTarget = createServerFn({ method: "GET" })
  .validator((d: { affiliationId: string }) => d)
  .handler(({ data }) => run((a) => registry.staffTxTarget(a, data.affiliationId)));
export const confirmStaffVerification = createServerFn({ method: "POST" })
  .validator((d: { affiliationId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => registry.confirmStaffVerification(a, data.affiliationId, data.txHash)));
export const confirmStaffSuspension = createServerFn({ method: "POST" })
  .validator((d: { affiliationId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => registry.confirmStaffSuspension(a, data.affiliationId, data.txHash)));
export const getHospitalProfile = createServerFn({ method: "GET" }).handler(() => run((a) => registry.hospitalProfile(a)));
export const addDepartment = createServerFn({ method: "POST" })
  .validator((d: { name: string; type: string; acceptsOutsideRequisitions?: boolean }) => d)
  .handler(({ data }) => run((a) => registry.addDepartment(a, data)));
export const setDepartmentSharing = createServerFn({ method: "POST" })
  .validator((d: { departmentId: string; accepts: boolean }) => d)
  .handler(({ data }) => run((a) => registry.setDepartmentSharing(a, data.departmentId, data.accepts)));

// ---------------------------------------------------------------- hospital application and registrar
export const submitApplication = createServerFn({ method: "POST" })
  .validator((d: ApplicationInput) => d)
  .handler(({ data }) => runPublic(() => registry.submitApplication(data)));
export const getRegistry = createServerFn({ method: "GET" }).handler(() => run((a) => registry.registryOverview(a)));
export const confirmHospitalApproval = createServerFn({ method: "POST" })
  .validator((d: { applicationId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => registry.confirmHospitalApproval(a, data.applicationId, data.txHash)));
export const rejectApplication = createServerFn({ method: "POST" })
  .validator((d: { applicationId: string; note: string }) => d)
  .handler(({ data }) => run((a) => registry.rejectApplication(a, data.applicationId, data.note)));
export const confirmHospitalStatus = createServerFn({ method: "POST" })
  .validator((d: { hospitalId: string; txHash: string }) => d)
  .handler(({ data }) => run((a) => registry.confirmHospitalStatus(a, data.hospitalId, data.txHash)));
