import { JobConfigDetailsApiType } from "@/types/app.type";

export type JobTaskErrorsTabsPropsType = {
  currentErrorType: string;
  setCurrentErrorType: (tab: string) => void;
};

export type JobTaskDetailsPropsType = {
  jobConfigDetails: JobConfigDetailsApiType;
};

export type ErrorsListTablePropsType = {
  currentErrorType: string;
};

export type ErrorLogActionButtonPropsType = {
  data: { ready: boolean; processing: boolean };
  handleGenerate: () => void;
  handleDownload: () => void;
  disabled?: boolean;
  generateLabel: string;
  downloadLabel: string;
};
