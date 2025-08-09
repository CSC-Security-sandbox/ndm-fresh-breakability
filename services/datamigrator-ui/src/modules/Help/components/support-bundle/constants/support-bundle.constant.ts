import * as yup from "yup";

export const SUPPORT_BUNDLE_FORM_VALIDATION_SCHEMA = yup.object().shape({
  startDate: yup
    .string()
    .test(
      "is-not-future",
      "Start date cannot be in the future",
      function (value) {
        if (!value) return true;
        const selectedDate = new Date(value);
        const today = new Date();

        // Compare only dates, not time
        selectedDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        return selectedDate <= today;
      }
    ),
  endDate: yup
    .string()
    .test(
      "is-not-future",
      "End date cannot be in the future",
      function (value) {
        if (!value) return true;
        const selectedDate = new Date(value);
        const today = new Date();

        // Compare only dates, not time
        selectedDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        return selectedDate <= today;
      }
    ),
});

export const INITIAL_FORM_STATE = {
  startDate: "",
  endDate: "",
  otherMetrics: "",
  projectWorker: "",
  isValid: false,
  isProcessing: false,
};

export const DOWNLOAD_REPORT_LABEL = "Download Report";
export const METRICS_OPTIONS = [
  { label: "State Data", value: 1 },
  { label: "System Inventory Data", value: 2 },
  { label: "Configuration Data", value: 3 },
  { label: "Performance Metrics", value: 4 },
];

export const GENERATE_SUPPORT_BUNDLE_LABEL = "Generate Support Bundle";
export const GENERATING_SUPPORT_BUNDLE_LABEL = "Generating Support Bundle";
export const PROJECT_AND_WORKER_LABEL = "Project and Worker";
