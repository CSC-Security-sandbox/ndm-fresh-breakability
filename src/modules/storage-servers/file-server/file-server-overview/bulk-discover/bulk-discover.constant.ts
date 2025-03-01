import * as yup from "yup";

export const BULK_DISCOVERY_FORM_SCHEMA = yup.object().shape({
  excludeFilePatterns: yup.string().notRequired(),
  scheduleTime: yup
    .string()
    .oneOf(["start_now", "schedule_date"], "Invalid selection for first run.")
    .required("First run option is required."),
});
