import * as yup from "yup";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export const DEFAULT_MINUTES_AHEAD = {
  START_NOW: 0,
  SCHEDULE_DATE: 5,
};

const TIMESTAMP_VALIDATION = {
  SCHEDULE_FUTURE_TIMESTAMP: "Scheduled date and time must be in the future",
  SCHEDULE_LATER_TIMESTAMP:
    "Date and time is required when scheduling for later",
  SCHEDULE_ONE_MINUTE_AHEAD_TIMESTAMP:
    "Scheduled date and time must be at least 1 minute from now",
};

const PROTOCOL_REQUIRED = "Protocol selection is required.";

const INVALID_SELECTION = "Invalid selection for first run.";

export const BULK_DISCOVERY_FORM_SCHEMA = yup.object().shape({
  excludeFilePatterns: yup.string().notRequired(),
  scheduleTime: yup
    .string()
    .oneOf(["start_now", "schedule_date"], INVALID_SELECTION)
    .required("First run option is required."),
  firstRunAt: yup.mixed().when("scheduleTime", {
    is: "schedule_date",
    then: (schema) =>
      schema
        .required(TIMESTAMP_VALIDATION?.SCHEDULE_LATER_TIMESTAMP)
        .test(
          "is-future-date",
          TIMESTAMP_VALIDATION?.SCHEDULE_FUTURE_TIMESTAMP,
          function (value) {
            if (!value) return false;
            const selectedDate = dayjs(value as any);
            const now = dayjs();
            return selectedDate.isValid() && selectedDate.isAfter(now);
          }
        )
        .test(
          "min-time-ahead",
          TIMESTAMP_VALIDATION?.SCHEDULE_ONE_MINUTE_AHEAD_TIMESTAMP,
          function (value) {
            if (!value) return false;
            const selectedDate = dayjs(value as any);
            const minFutureTime = dayjs().add(1, "minute");
            return (
              selectedDate.isValid() &&
              (selectedDate.isAfter(minFutureTime) ||
                selectedDate.isSame(minFutureTime))
            );
          }
        ),
    otherwise: (schema) => schema.notRequired(),
  }),
  protocol: yup.object().required(PROTOCOL_REQUIRED),
  shouldScanADS: yup.string().oneOf(["yes", "no"]).notRequired(),

});
