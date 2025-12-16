import React, { useMemo, useState, useEffect } from "react";
import { Box } from "@components/container/index";
import { Text } from "@netapp/bxp-design-system-react";
import { FormikProps } from "formik";
import { MappingStepFormikFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { Radio, RadioGroup, FormControlLabel} from "@mui/material";
import { Popover, RadioButton, Text as EditText } from "@netapp/bxp-design-system-react";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import {
  DATE_FORMAT,
  DEFAULT_MINUTES_AHEAD,
  SCHEDULE_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";

dayjs.extend(utc);

const getDefaultDateTime = (scheduleType: string) => {
  const minutesAhead =
    scheduleType === SCHEDULE_OPTIONS?.START_NOW
      ? DEFAULT_MINUTES_AHEAD?.START_NOW
      : DEFAULT_MINUTES_AHEAD?.SCHEDULE_DATE;

  return dayjs.utc().add(minutesAhead, "minute");
};

const BulkMigrateScheduleComponent = ({
  mappingStepForm,
  variant,
}: {
  mappingStepForm: FormikProps<MappingStepFormikFormType>;
  variant: "normal_run" | "edit_config";
}) => {
  const { values, setFieldValue, errors } = mappingStepForm;
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    if(variant === "edit_config") {
      return;
    }
    if (values?.scheduleTime === SCHEDULE_OPTIONS?.START_NOW) {
      setFieldValue(
        "scheduledDateTime",
        getDefaultDateTime(SCHEDULE_OPTIONS?.START_NOW)
      );
    } else {
      setFieldValue(
        "scheduledDateTime",
        getDefaultDateTime(SCHEDULE_OPTIONS?.SCHEDULE_DATE)
      );
    }
  }, [values?.scheduleTime]);

  const errorMessage = useMemo(() => {
    const scheduledError = errors?.scheduledDateTime;
    if (typeof scheduledError === "string") {
      return scheduledError;
    }
    if (pickerError === "disablePast") {
      return "You can't select a date in the past";
    }
    return "";
  }, [pickerError, errors?.scheduledDateTime]);

  if(variant === "normal_run") {
    return (
      <Box className="w-1/2">
        <Text>Job Schedule</Text>
        <RadioGroup
          name="scheduleTime"
          value={values?.scheduleTime || SCHEDULE_OPTIONS?.START_NOW}
          onChange={(e) => {
            setFieldValue("scheduleTime", e.target.value);
          }}
        >
          <Box className="flex">
            <FormControlLabel
              value={SCHEDULE_OPTIONS?.START_NOW}
              control={<Radio />}
              label="Start Now"
            />
            <FormControlLabel
              value={SCHEDULE_OPTIONS?.SCHEDULE_DATE}
              control={<Radio />}
              label="Schedule Date & Time (UTC)"
            />
          </Box>
        </RadioGroup>
        {values.scheduleTime === SCHEDULE_OPTIONS?.SCHEDULE_DATE && (
          <Box className="flex gap-3 mt-3">
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DateTimePicker
                value={
                  values.scheduledDateTime ||
                  getDefaultDateTime(SCHEDULE_OPTIONS?.SCHEDULE_DATE)
                }
                timezone="UTC"
                slotProps={{
                  textField: {
                    helperText: errorMessage,
                    error: !!errorMessage,
                  },
                }}
                onError={(newError) => setPickerError(newError)}
                onChange={(newValue) => {
                  setFieldValue("scheduledDateTime", newValue);
                  setPickerError(null);
                }}
                format={DATE_FORMAT}
                disablePast
                timeSteps={{ minutes: 1 }}
              />
            </LocalizationProvider>
          </Box>
        )}
      </Box>
    );
  }
else{
  return (
      <Box>
        <Box className="flex gap-2 items-center">
          <EditText bold className="!mb-0">Job Schedule</EditText>
          <Popover placement="right" verticalPlacement="center">
            Schedule a job run for a specific date & time
          </Popover>
        </Box>
        <Box>
          <RadioGroup
          name="scheduleTime"
          value={values?.scheduleTime}
          onChange={(e) => {
            setFieldValue("scheduleTime", e.target.value);
          }}
        >
          <Box>
            <FormControlLabel
              value={SCHEDULE_OPTIONS?.SCHEDULE_DATE}
              control={<Radio size="medium" sx={{ color: 'black', '& .MuiSvgIcon-root': { fontSize: 20 } }} />}
              label="Schedule Date & Time (UTC)"
            />
          </Box>
        </RadioGroup>
        </Box>
        {values.scheduleTime === SCHEDULE_OPTIONS?.SCHEDULE_DATE && (
          <Box>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DateTimePicker
                value={
                  values?.scheduledDateTime
                }
                timezone="UTC"
                slotProps={{
                  textField: {
                    helperText: errorMessage,
                    error: !!errorMessage,
                    sx: { width: '300px' },
                  },
                  popper: { sx: { zIndex: 200000010 } },
                }}
                onError={(newError) => setPickerError(newError)}
                onChange={(newValue) => {
                  setFieldValue("scheduledDateTime", newValue);
                  setPickerError(null);
                }}
                format={DATE_FORMAT}
                disablePast
                timeSteps={{ minutes: 1 }}
              />
            </LocalizationProvider>
          </Box>
        )}
      </Box>
    );
  }
};

export default BulkMigrateScheduleComponent;
