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
