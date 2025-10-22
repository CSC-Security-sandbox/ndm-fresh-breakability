import { BlueXpFormType, isBundleReadyApiType } from "@/types/app.type";

export type SupportBundleContextType = {
  supportBundleForm: BlueXpFormType<SupportBundleFormType>;
  handleDateChange: (value: any) => void;
  handleDownloadReport: () => void;
  handleGenerateBundle: () => void;
  bundleStatus: isBundleReadyApiType;
  selectedItems: string[];
  treeSelectStyles: any;
  handleSelectionChange: (selectedItems: any[]) => void;
  wrapperClass: string;
  projectWorkerData: ProjectWorkerMap;
  isDownloading: boolean;
  infoMessage: Record<string, string>;
};

export type SupportBundlePayloadType = {
  startDate: string;
  endDate: string;
  otherMetrics: any;
  projectWorkerMap: ProjectWorkerMap;
};

export type SupportBundleFormType = {
  startDate: any;
  endDate: any;
  otherMetrics: any;
  isValid: boolean;
  isProcessing: boolean;
  projectWorker: ProjectWorkerMap;
};

export type SupportBundleFormErrorsType = {
  startDate?: string;
  endDate?: string;
};

type ProjectWorkerMap = {
  projectId?: string;
  workerIds?: string[];
}[];
