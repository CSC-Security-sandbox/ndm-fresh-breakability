import {
  BlueXpFormType,
  BlueXpTableStateType,
  FileServerDetailsType,
  GetAllCutOverPathsApiType,
  JobRunApiType,
} from "@/types/app.type";
import { ReactNode } from "react";

export interface BulkCutOverContextProviderType {
  children?: ReactNode;
  jobRunList: JobRunApiType[];
  cutOverSelectedIds: string[];
  setCutOverSelectedIds: Function;
  reviewStepSelectedIds: string[];
  setReviewStepSelectedIds: Function;
  BulkCutOverForm: BlueXpFormType<bulkCutOverFormType>;
  selectPathTableState: BlueXpTableStateType<GetAllCutOverPathsApiType>;
  jobRunListPathTableState: BlueXpTableStateType<JobRunApiType>;
  allCutOverPaths: GetAllCutOverPathsApiType[];
  fileServerDetails: FileServerDetailsType;
  handleCreateJobCutOverApi: Function;
  isSubmittingBulkCutover: boolean;
}
export interface bulkCutOverFormType {
  isSelectPathConformed: false;
  isReviewConformed: false;
}

// CREATE CUTOVER API
export interface CreateBulkCutOverApiPayloadType {
  cutoverConfig: {
    sourcePathId: string;
    destinationPathId: string[];
  }[];
}

export interface UserWarningPropsType {
  form: BlueXpFormType<bulkCutOverFormType>;
  controlName: string;
  warningMessage: string;
}
