export type ActionButtonsPropsType = {
  selectedRowIds: string[];
  showResumeButton?: boolean;
  rows?: rowMenuPropsType[];
};

export type StatusType = "RUNNING" | "PAUSED" | "STOPPED";

export type DataItem = {
  status: StatusType;
};

export type rowMenuPropsType = { jobRunId: string; status: string };
