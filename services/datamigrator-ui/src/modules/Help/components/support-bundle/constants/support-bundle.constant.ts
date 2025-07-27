export const METRICS_OPTIONS = [
  { label: "State Data", value: 1 },
  { label: "System Inventory Data", value: 2 },
  { label: "Configuration Data", value: 3 },
  { label: "Performance Metrics", value: 4 },
];

export const INITIAL_FORM_STATE = {
  start_date: "",
  end_date: "",
  project_worker: "",
  other_metrics: "",
  isValid: false,
  isProcessing: false,
};

export const DOWNLOAD_REPORT_LABEL = "Download Report";

export const GENERATE_SUPPORT_BUNDLE_LABEL = "Generate Support Bundle";

export const GENERATING_SUPPORT_BUNDLE_LABEL = "Generating Support Bundle";

export const SELECT_PROJECT_AND_WORKER_LABEL = "Select Project and Worker";
