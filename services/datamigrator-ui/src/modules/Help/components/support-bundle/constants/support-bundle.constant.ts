import * as yup from "yup";

export const SUPPORT_BUNDLE_FORM_VALIDATION_SCHEMA = yup.object().shape({
  startDate: yup.string().required("Start date is required"),
  endDate: yup.string().required("End date is required"),
});

export const INITIAL_FORM_STATE = {
  startDate: "",
  endDate: "",
  project_worker: "",
  other_metrics: "",
  isValid: false,
  isProcessing: false,
};

export const DOWNLOAD_REPORT_LABEL = "Download Report";
export const METRICS_OPTIONS = [{ label: "Configuration Data", value: 1 }];
export const GENERATE_SUPPORT_BUNDLE_LABEL = "Generate Support Bundle";
export const GENERATING_SUPPORT_BUNDLE_LABEL = "Generating Support Bundle";
