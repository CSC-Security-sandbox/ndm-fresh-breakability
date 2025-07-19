import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { DemoContainer } from "@mui/x-date-pickers/internals/demo";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { DateTimePickerWrapperPropsType } from "@components/date-time-picker-wrapper/DateTimePickerWrapper.interface";
import { useMemo, useState } from "react";

dayjs.extend(utc);
const today = dayjs();
const todayStartOfTheDay = today.startOf("day");

const DateTimePickerWrapper = ({
  bulkDiscoveryForm,
}: DateTimePickerWrapperPropsType) => {
  const [error, setError] = useState<string | null>("");

  const errorMessage = useMemo(() => {
    // Get validation error from form schema first
    const formErrors = bulkDiscoveryForm?.formErrors as any;
    const formError = formErrors?.firstRunAt;
    if (formError && typeof formError === "string") {
      return formError;
    }

    // Fallback to date picker errors
    switch (error) {
      case "disablePast":
        return "You can't select a date in the past";
      default: {
        return "";
      }
    }
  }, [error, bulkDiscoveryForm?.formErrors]);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DemoContainer components={["DateTimePicker"]}>
        <DateTimePicker
          defaultValue={todayStartOfTheDay}
          value={bulkDiscoveryForm?.formState?.firstRunAt}
          timezone="UTC"
          slotProps={{
            textField: {
              helperText: errorMessage,
              error: !!errorMessage,
            },
          }}
          onError={(newError) => setError(newError)}
          onChange={(newValue) => {
            bulkDiscoveryForm.resetForm({
              ...bulkDiscoveryForm.formState,
              firstRunAt: newValue,
            });
          }}
          format="DD/MM/YYYY hh:mm:A UTC"
          disablePast
          timeSteps={{ minutes: 1 }}
        />
      </DemoContainer>
    </LocalizationProvider>
  );
};

export default DateTimePickerWrapper;
