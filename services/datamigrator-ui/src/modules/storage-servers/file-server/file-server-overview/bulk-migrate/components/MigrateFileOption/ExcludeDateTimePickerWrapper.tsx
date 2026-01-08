import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { DemoContainer } from "@mui/x-date-pickers/internals/demo";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { ExcludeDateTimePickerWrapperPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/MigrateFileOption/ExcludeDateTimePickerWrapper.interface";
import { useMemo, useState } from "react";
import { MODAL_POPPER_ZINDEX } from "@utils/constants";

dayjs.extend(utc);
const today = dayjs();
const todayStartOfTheDay = today.startOf("day");

const DateTimePickerWrapper = ({
  form,
}: ExcludeDateTimePickerWrapperPropsType) => {
  const [error, setError] = useState<string | null>("");

  const errorMessage = useMemo(() => {
    switch (error) {
      case "disableFuture":
        return "You can't select a date in the future";

      default: {
        return "";
      }
    }
  }, [error]);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DemoContainer components={["DateTimePicker"]}>
        <DateTimePicker
          defaultValue={todayStartOfTheDay}
          value={form?.formState?.migrate_file_option_exclude}
          timezone="UTC"
          slotProps={{
            textField: {
              helperText: errorMessage,
            },
            popper: { sx: { zIndex: MODAL_POPPER_ZINDEX } },
          }}
          onError={(newError) => setError(newError)}
          onChange={(newValue) => {
            form.resetForm({
              ...form.formState,
              migrate_file_option_exclude: newValue,
            });
          }}
          format="DD/MM/YYYY hh:mm:A UTC"
          disableFuture
          timeSteps={{ minutes: 1 }}
        />
      </DemoContainer>
    </LocalizationProvider>
  );
};

export default DateTimePickerWrapper;
