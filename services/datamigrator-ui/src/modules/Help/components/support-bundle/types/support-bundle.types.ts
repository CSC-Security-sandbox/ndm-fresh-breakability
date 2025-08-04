import { BlueXpFormType, isBundleReadyApiType } from "@/types/app.type";

export type SupportBundleContextType = {
  supportBundleForm: BlueXpFormType<SupportBundleFormType>;
  handleDateChange: (value: any) => void;
  handleDownloadReport: () => void;
  handleGenerateBundle: () => void;
  bundleStatus: isBundleReadyApiType;
};

export type SupportBundlePayloadType = {
  startDate: string;
  endDate: string;
  otherMetrics: any;
};

export type SupportBundleFormType = {
  startDate: any;
  endDate: any;
  project_worker: string;
  other_metrics: any;
  isValid: boolean;
  isProcessing: boolean;
};
