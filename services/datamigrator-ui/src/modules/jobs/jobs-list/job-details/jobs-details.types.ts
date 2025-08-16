import { JobRunErrorsOverviewApiType } from "@/types/app.type";

export type JobErrorsPropsType = {
  latestJobRunId: string;
  setErrorDetails: (details: JobRunErrorsOverviewApiType[]) => void;
  errorDetails: JobRunErrorsOverviewApiType[];
};
