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
  setCutOverSelectedIds: (arg: any) => void;
  reviewStepSelectedIds: string[];
  setReviewStepSelectedIds: (arg: any) => void;
  BulkCutOverForm: BlueXpFormType<bulkCutOverFormType>;
  selectPathTableState: BlueXpTableStateType<GetAllCutOverPathsApiType>;
  jobRunListPathTableState: BlueXpTableStateType<JobRunApiType>;
  allCutOverPaths: GetAllCutOverPathsApiType[];
  fileServerDetails: FileServerDetailsType;
  handleCreateJobCutOverApi: (arg: any) => void;
  isSubmittingBulkCutover: boolean;
  isFetching: boolean;
  refetch: () => void;
  isCutOverPathsFetching: boolean;
  refetchCutOverPaths: () => void;
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
    sourceDirectoryPath?: string;
    destinationDirectoryPath?: string;
  }[];
}

export interface UserWarningPropsType {
  form: BlueXpFormType<bulkCutOverFormType>;
  controlName: string;
  warningMessage: string;
}
