import React, { useMemo, useState, useEffect } from "react";
import { Box } from "@components/container/index";
import { Text } from "@netapp/bxp-design-system-react";
import { FormikProps } from "formik";
import { MappingStepFormikFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { Radio, RadioGroup, FormControlLabel } from "@mui/material";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

const BulkMigrateScheduleComponent = ({
  mappingStepForm,
}: {
  mappingStepForm: FormikProps<MappingStepFormikFormType>;
}) => {
  const { values, setFieldValue } = mappingStepForm;
  const [error, setError] = useState<string | null>(null);

  // Reset error state on first render
  useEffect(() => {
    setError(null);
  }, []);

  const errorMessage = useMemo(() => {
    switch (error) {
      case "disablePast":
        return "You can't select a date in the past";
      default:
        return "";
    }
  }, [error]);

  return (
    <Box className="w-1/2">
      <Text>Job Schedule</Text>
      <RadioGroup
        name="scheduleTime"
        value={values.scheduleTime || "start_now"}
        onChange={(e) => {
          if (e.target.value === "start_now") {
            setFieldValue("scheduledDateTime", dayjs().add(1, "minute"));
          }
          setFieldValue("scheduleTime", e.target.value);
        }}
      >
        <Box className="flex">
          <FormControlLabel
            value="start_now"
            control={<Radio />}
            label="Start Now"
          />
          <FormControlLabel
            value="schedule_date"
            control={<Radio />}
            label="Schedule Date & Time (UTC)"
          />
        </Box>
      </RadioGroup>
      {values.scheduleTime === "schedule_date" && (
        <Box className="flex gap-3 mt-3">
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DateTimePicker
              value={values.scheduledDateTime || dayjs().add(1, "minute")}
              timezone="UTC"
              slotProps={{
                textField: {
                  helperText: errorMessage,
                },
              }}
              onError={(newError) => setError(newError)}
              onChange={(newValue) => {
                setFieldValue("scheduledDateTime", newValue);
                setError(null);
              }}
              format="DD/MM/YYYY hh:mm:A UTC"
              disablePast
              timeSteps={{ minutes: 1 }}
            />
          </LocalizationProvider>
        </Box>
      )}
    </Box>
  );
};

export default BulkMigrateScheduleComponent;
