import * as yup from "yup";
import {
  isValidDate,
  isDateInFuture,
} from "@modules/Help/components/support-bundle/utils/support-bundle.utils";

export const SUPPORT_BUNDLE_FORM_VALIDATION_SCHEMA = yup.object().shape({
  startDate: yup
    .mixed()
    .nullable()
    .test("is-required", "Start date is required", function (value) {
      if (value === null || value === undefined) return true;

      return isValidDate(value);
    })
    .test("not-future", "Start date cannot be in the future", function (value) {
      if (!isValidDate(value)) return true;
      return !isDateInFuture(value);
    }),

  endDate: yup
    .mixed()
    .nullable()
    .test("is-required", "End date is required", function (value) {
      if (value === null || value === undefined) return true;

      return isValidDate(value);
    })
    .test("not-future", "End date cannot be in the future", function (value) {
      if (!isValidDate(value)) return true;
      return !isDateInFuture(value);
    }),

  projectWorker: yup
    .mixed()
    .test(
      "is-required",
      "Project and Worker selection is required",
      function (value) {
        console.log("value", value);
        if (!value) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "string") return value.trim() !== "";
        return true;
      }
    )
    .test(
      "has-project-worker-data",
      "Please select both project and worker data",
      function (value) {
        if (!Array.isArray(value)) return true;

        let hasProject = false;
        let hasWorker = false;

        value.forEach((item) => {
          if (item?.children || item?.childrens) {
            hasProject = true;
          } else {
            hasWorker = true;
          }
        });

        return hasProject && hasWorker;
      }
    ),
});

export const INITIAL_FORM_STATE = {
  startDate: null,
  endDate: null,
  otherMetrics: "",
  projectWorker: "",
};

export const DOWNLOAD_REPORT_LABEL = "Download Report";
export const SEND_SUPPORT_BUNDLE_LABEL = "Send Support Bundle";
export const SEND_SUPPORT_BUNDLE_TOOLTIP = "Send diagnostic logs to NetApp for troubleshooting.";
export const METRICS_OPTIONS = [
  { label: "State Data", value: 1 },
  { label: "System Inventory Data", value: 2 },
  { label: "Configuration Data", value: 3 },
  { label: "Performance Metrics", value: 4 },
];

export const GENERATE_SUPPORT_BUNDLE_LABEL = "Generate Support Bundle";
export const GENERATING_SUPPORT_BUNDLE_LABEL = "Generating Support Bundle";
export const PROJECT_AND_WORKER_LABEL = "Project and Worker";
