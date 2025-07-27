export type SupportBundleContextType = {
  form: Record<string, any>;
  projectWorkerData: Array<Record<string, string>>;
  bundleReadyStatus: Record<string, boolean>;
  treeSelectStyles: string;
  handleSelectionChange: (value: any) => void;
  wrapperClass: string;
  handleDateChange: (value: any) => void;
  handleDownloadReport: () => void;
  handleGenerateBundle: () => void;
};

export type SupportBundlePayloadType = {
  projectWorkerMap: { projectId?: string; workerIds?: string[] }[];
  startDate: string;
  endDate: string;
  otherMetrics: any;
};
