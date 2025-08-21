import { BlueXpFormType, isBundleReadyApiType } from "@/types/app.type";

export type SupportBundleContextType = {
  supportBundleForm: BlueXpFormType<SupportBundleFormType>;
  handleDateChange: (value: any) => void;
  handleDownloadReport: () => void;
  handleGenerateBundle: () => void;
  bundleStatus: isBundleReadyApiType;
  isDownloading: boolean;
};

export type SupportBundlePayloadType = {
  startDate: string;
  endDate: string;
  otherMetrics: any;
};

export type SupportBundleFormType = {
  startDate: any;
  endDate: any;
  otherMetrics: any;
  isValid: boolean;
  isProcessing: boolean;
};

export type SupportBundleFormErrorsType = {
  startDate?: string;
  endDate?: string;
};
