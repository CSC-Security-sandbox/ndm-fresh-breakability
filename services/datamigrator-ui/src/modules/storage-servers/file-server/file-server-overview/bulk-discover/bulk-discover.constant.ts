import * as yup from "yup";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export const BULK_DISCOVERY_FORM_SCHEMA = yup.object().shape({
  excludeFilePatterns: yup.string().notRequired(),
  scheduleTime: yup
    .string()
    .oneOf(["start_now", "schedule_date"], "Invalid selection for first run.")
    .required("First run option is required."),
  firstRunAt: yup.mixed().when("scheduleTime", {
    is: "schedule_date",
    then: (schema) =>
      schema
        .required(
          "Schedule date and time is required when scheduling for later"
        )
        .test(
          "is-future-date",
          "Schedule date must be in the future",
          function (value) {
            if (!value) return false;
            const selectedDate = dayjs(value as any);
            const now = dayjs();
            return selectedDate.isValid() && selectedDate.isAfter(now);
          }
        )
        .test(
          "min-time-ahead",
          "Schedule date must be at least 1 minute in the future",
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
  protocol: yup.object().required("Protocol selection is required."),
});
