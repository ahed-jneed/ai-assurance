// Every form the modal host can open, by the name passed to open().
import { classificationModal } from "./classification";
import { clientEditModal, clientModal } from "./client";
import { engagementModal } from "./engagement";
import { engagementSettingsModal } from "./engagement-settings";
import {
  requestAssessModal,
  requestCloseModal,
  requestEditModal,
  requestModal,
  requestReopenModal,
  requestResponseModal,
} from "./evidence-request";
import { findingModal } from "./finding";
import { findingEditModal } from "./finding-edit";
import { linkEvidenceModal } from "./link-evidence";
import { memberEditModal, memberModal } from "./member";
import { memberRevokeModal } from "./member-revoke";
import { paperModal } from "./paper";
import {
  adminGrantModal,
  adminRevokeModal,
  adminTransferModal,
  invitationCancelModal,
  inviteModal,
  practiceRenameModal,
} from "./practice-access";
import { reportModal } from "./report";
import type { ModalDefinition } from "./types";
import { uploadModal } from "./upload";

const modalDefinitions: Record<string, ModalDefinition> = {
  paper: paperModal,
  linkEvidence: linkEvidenceModal,
  client: clientModal,
  clientEdit: clientEditModal,
  engagement: engagementModal,
  rename: engagementSettingsModal,
  member: memberModal,
  memberEdit: memberEditModal,
  memberRevoke: memberRevokeModal,
  invite: inviteModal,
  invitationCancel: invitationCancelModal,
  practiceRename: practiceRenameModal,
  adminGrant: adminGrantModal,
  adminRevoke: adminRevokeModal,
  adminTransfer: adminTransferModal,
  upload: uploadModal,
  classification: classificationModal,
  finding: findingModal,
  findingEdit: findingEditModal,
  report: reportModal,
  request: requestModal,
  requestEdit: requestEditModal,
  requestResponse: requestResponseModal,
  requestAssess: requestAssessModal,
  requestClose: requestCloseModal,
  requestReopen: requestReopenModal,
};
export const modalKinds = Object.keys(modalDefinitions);
export const modalDefinition = (kind: string): ModalDefinition | undefined =>
  Object.hasOwn(modalDefinitions, kind) ? modalDefinitions[kind] : undefined;
