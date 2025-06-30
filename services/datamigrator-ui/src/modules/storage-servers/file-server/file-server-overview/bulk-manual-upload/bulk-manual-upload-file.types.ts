import { JSX, ReactNode } from "react";
import {
  BlueXpFormType,
  ConfigListTypeApiType,
  VolumeType,
} from "@/types/app.type";

export type UploadedFilePropsType = {
  uploadId: string;
  newPaths: number;
  alreadyExitingPaths: number;
  noLongerAvailablePaths: number;
};

export type ModalConfigPropsType = {
  modalHeader: string;
  modalContent: ReactNode | JSX.Element;
  modalFooter: ReactNode | JSX.Element;
};

export type BulkManualUploadModalContentPropsType = {
  exportPathSource: boolean | string | null;
};

export type BulkManualUploadPropsType = {
  fileServerDetails: ConfigListTypeApiType;
  allExportPaths: VolumeType[];
};

export type UploadFileDetailsPropsType = {
  exportPathSourceData: UploadedFilePropsType;
};

export type UploadExportPathSourceFileProps = {
  fileServerId: string;
  body: BlueXpFormType<BulkManualUploadModalContentPropsType>;
};

export type BulkManualUploadErrorPropsType {
  error: string;
}