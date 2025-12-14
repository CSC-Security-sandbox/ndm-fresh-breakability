import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { DemoContainer } from "@mui/x-date-pickers/internals/demo";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import {
  DateTimePickerWrapperPropsType,
  FormErrors,
} from "@components/date-time-picker-wrapper/DateTimePickerWrapper.interface";
import { useMemo, useState } from "react";

dayjs.extend(utc);
const today = dayjs();
const todayStartOfTheDay = today.startOf("day");

const DateTimePickerWrapper = ({
  bulkDiscoveryForm,
}: DateTimePickerWrapperPropsType) => {
  const [error, setError] = useState<string | null>("");

  const errorMessage = useMemo(() => {
    const formErrors = bulkDiscoveryForm?.formErrors as FormErrors;
    const firstRunAtError = formErrors?.firstRunAt;
    if (typeof firstRunAtError === "string") {
      return firstRunAtError;
    }
    if (error === "disablePast") {
      return "You can't select a date in the past";
    }
    return "";
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
            popper: { sx: { zIndex: 200000010 } },
          }}
          onError={(newError) => setError(newError)}
          onChange={(newValue) => {
            bulkDiscoveryForm.wrappedHandleFormChange('firstRunAt')(newValue, null);
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
