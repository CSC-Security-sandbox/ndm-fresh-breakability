import { Box } from "@components/container/index";
import {
  FormFieldSelect,
  RadioButton,
  Text,
} from "@netapp/bxp-design-system-react";
import {
  INCREMENTAL_SYNC_SCHEDULE_SET_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import {
  DOW_OPTIONS,
  // WEEK_OPTIONS,
  WEEKDAY_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { useContext } from "react";

const ScheduleOptions = () => {
  const { optionForm } = useContext(BulkMigrateContext);

  return (
    <Box className="w-full">
      <Text className="flex gap-6">
        <RadioButton
          form={optionForm}
          name="incremental_sync_schedule_set"
          value={INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.HOURLY}
        >
          Hourly
        </RadioButton>
        <RadioButton
          form={optionForm}
          name="incremental_sync_schedule_set"
          value={INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.DAILY}
        >
          Daily
        </RadioButton>
        <RadioButton
          form={optionForm}
          name="incremental_sync_schedule_set"
          value={INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.WEEKLY}
        >
          Weekly
        </RadioButton>
      </Text>
      {optionForm.formState.incremental_sync_schedule_set ===
        INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.DAILY && (
        <Box className="flex flex-col gap-3 mt-3">
          <Text>Schedule Daily Start time</Text>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <MobileTimePicker
              openTo="hours"
              className="w-52"
              
              value={optionForm.formState.incremental_sync_schedule_daily}
              onChange={(newValue) => {
                optionForm.resetForm({
                  ...optionForm.formState,
                  incremental_sync_schedule_daily: newValue,
                });
              }}
            />
          </LocalizationProvider>
        </Box>
      )}
      {optionForm.formState.incremental_sync_schedule_set ===
        INCREMENTAL_SYNC_SCHEDULE_SET_ENUM.WEEKLY && (
        <Box className="flex flex-col mt-3">
          <RadioButton
            form={optionForm}
            name="incremental_sync_schedule_weekly"
            value={INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.DAY}
          >
            <Box className="flex w-full items-baseline gap-2 pt-4">
              <Box>Day</Box>
              <FormFieldSelect
                name="incremental_sync_schedule_weekly_day"
                form={optionForm}
                options={DOW_OPTIONS}
                placeholder="1"
                style={{ width: 100 }}
                disabled={
                  optionForm.formState.incremental_sync_schedule_weekly ===
                  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.WEEKDAY
                }
              />
              <Box>of every Week</Box>
              {/* TODO: Following part is not supported as cron expression, check for backend solution */}
              {/* <Box>of every</Box>
              <FormFieldSelect
                name="incremental_sync_schedule_weekly_day_week"
                form={optionForm}
                options={WEEK_OPTIONS}
                placeholder="1"
                style={{ width: 100 }}
                disabled={
                  optionForm.formState.incremental_sync_schedule_weekly ===
                  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.WEEKDAY
                }
              />
              <Box>week(s)</Box> */}
            </Box>
          </RadioButton>
          <RadioButton
            form={optionForm}
            name="incremental_sync_schedule_weekly"
            value={INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.WEEKDAY}
          >
            <Box className="flex w-full items-baseline gap-2 pt-4">
              <FormFieldSelect
                name="incremental_sync_schedule_weekly_weekday"
                form={optionForm}
                options={WEEKDAY_OPTIONS}
                placeholder="weekday"
                style={{ width: 150 }}
                disabled={
                  optionForm.formState.incremental_sync_schedule_weekly ===
                  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.DAY
                }
              />
              <Box>of every Week</Box>
              {/* TODO: Following part is not supported as cron expression, check for backend solution */}
              {/* <Text>of every</Text>
              <FormFieldSelect
                name="incremental_sync_schedule_weekly_weekday_week"
                form={optionForm}
                options={WEEK_OPTIONS}
                placeholder="1"
                style={{ width: 100 }}
                disabled={
                  optionForm.formState.incremental_sync_schedule_weekly ===
                  INCREMENTAL_SYNC_SCHEDULE_SET_WEEKLY_ENUM.DAY
                }
              />
              <Text>week(s)</Text> */}
            </Box>
          </RadioButton>
        </Box>
      )}
    </Box>
  );
};

export default ScheduleOptions;
