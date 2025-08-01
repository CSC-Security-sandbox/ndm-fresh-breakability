export type SupportBundleContextType = {
  form: Record<string, any>;
  bundleReadyStatus: Record<string, boolean>;
  handleDateChange: (value: any) => void;
  handleDownloadReport: () => void;
  handleGenerateBundle: () => void;
  isFormDataDifferentFromLastBundle: () => boolean;
  hasFormData: boolean;
  isBundleReady: boolean;
  isDownloadDisabled: boolean;
  isGenerateDisabled: boolean;
  showLoader: boolean;
};

export type SupportBundlePayloadType = {
  startDate: string;
  endDate: string;
  otherMetrics: any;
};
