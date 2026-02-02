import { Box } from "@components/container/index";
import {
  FormFieldInputNew,
  FormFieldSelect,
  Popover,
  RadioButton,
  Text,
} from "@netapp/bxp-design-system-react";
import { useContext, useMemo, useState } from "react";
import { BlueXpFormType } from "@/types/app.type";
import { OptionsFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import ScheduleOptions from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/ScheduleOptions/ScheduleOptions";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { isValidCron } from "cron-validator";
import cronstrue from "cronstrue";
import { WEEKDAY_OPTIONS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker";
import {
  INCREMENTAL_SYNC_SCHEDULE_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/incremental-sync-schedule.constants";
import RadioButtonGroup from "@components/radio-button/RadioButtonGroup";
import { MODAL_POPPER_ZINDEX } from "@utils/constants";

type IncrementalSyncScheduleProps = {
  variant: "normal_run" | "edit_config";
  optionForm?: BlueXpFormType<OptionsFormType>;
};

const IncrementalSyncSchedule = ({
  variant,
  optionForm
}: IncrementalSyncScheduleProps) => {
  optionForm = variant === "edit_config" ? optionForm : useContext(BulkMigrateContext).optionForm;
  const [cronErrorMessage, setCronErrorMessage] = useState<string>();
  const { incremental_sync_schedule_cron_expression } = optionForm.formState;

  const cronString = useMemo(() => {
    setCronErrorMessage("");
    try {
      if (!isValidCron(incremental_sync_schedule_cron_expression)) {
        throw new Error("Invalid cron expression");
      }
      const readable = cronstrue.toString(
        incremental_sync_schedule_cron_expression
      );
      return readable;
    } catch (error) {
      setCronErrorMessage(
        (error as Error).message || "Failed to validate cron expression"
      );
      return "";
    }
  }, [incremental_sync_schedule_cron_expression]);

  if(variant === "normal_run") {
    return (
      <Box className="w-5/6">
        <Box className="flex gap-2 items-center mb-2">
          <Text>Incremental sync schedule</Text>
          <Popover placement="right" verticalPlacement="center">
            Option to turn on incremental migrations, either by a schedule or with
            cron expression.
          </Popover>
        </Box>
        <Box className="flex gap-6">
          <RadioButtonGroup
            options={INCREMENTAL_SYNC_SCHEDULE_OPTIONS}
            form={optionForm}
            name="incremental_sync_schedule"
          />
        </Box>
        {optionForm.formState.incremental_sync_schedule ===
          INCREMENTAL_SYNC_SCHEDULE_ENUM.SCHEDULE && (
          <Box className="flex mt-3">
            <ScheduleOptions />
          </Box>
        )}
        {optionForm.formState.incremental_sync_schedule ===
          INCREMENTAL_SYNC_SCHEDULE_ENUM.CRON_EXPRESSION && (
          <Box className="flex flex-col mt-3">
            <FormFieldInputNew
              form={optionForm}
              name="incremental_sync_schedule_cron_expression"
              placeholder="* * * * *"
              label="Cron Expression"
              showError={
                !optionForm.formState.incremental_sync_schedule_cron_expression ||
                cronErrorMessage
              }
              errorMessage={
                cronErrorMessage?.replaceAll("Error: ", "") ||
                "This field is required"
              }
            />
            {!cronErrorMessage && <Text className="-mt-4">{cronString}</Text>}
          </Box>
        )}
      </Box>
    );
  }
  else{
    return (
      <Box>
        <Box className="flex gap-2 items-center mb-1">
          <Text bold className="!mb-0">Incremental sync schedule</Text>
          <Popover placement="right" verticalPlacement="center">
            Option to turn on incremental migrations, either by a schedule or with cron expression.
          </Popover>
        </Box>
        <Box className="flex gap-6">
          <RadioButtonGroup
            options={INCREMENTAL_SYNC_SCHEDULE_OPTIONS}
            form={optionForm}
            name="incremental_sync_schedule"
          />
        </Box>
        {optionForm.formState.incremental_sync_schedule ===
          INCREMENTAL_SYNC_SCHEDULE_ENUM.SCHEDULE && (
          <Box className="flex mt-3">
            <Box className="w-full">
              <Text className="flex gap-6">
                <RadioButton
                  form={optionForm}
                  name="incremental_sync_schedule_set"
                  value="hourly"
                >
                  Hourly
                </RadioButton>
                <RadioButton
                  form={optionForm}
                  name="incremental_sync_schedule_set"
                  value="daily"
                >
                  Daily
                </RadioButton>
                <RadioButton
                  form={optionForm}
                  name="incremental_sync_schedule_set"
                  value="weekly"
                >
                  Weekly
                </RadioButton>
              </Text>
              {optionForm.formState.incremental_sync_schedule_set === "daily" && (
                <Box className="flex flex-col gap-3 mt-3">
                  <Text>Schedule Daily Start time</Text>
                  <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <MobileTimePicker
                      openTo="hours"
                      className="w-52"
                      value={optionForm.formState.incremental_sync_schedule_daily}
                      onChange={(newValue) => {
                        optionForm.wrappedHandleFormChange("incremental_sync_schedule_daily")(newValue, null);
                      }}
                      slotProps={{
                        dialog: { sx: { zIndex: MODAL_POPPER_ZINDEX } },
                      }}
                    />
                  </LocalizationProvider>
                </Box>
              )}
              {optionForm.formState.incremental_sync_schedule_set === "weekly" && (
                <Box className="flex flex-col mt-3">
                  <Text>Select day of the week:</Text>
                  <Box className="flex gap-2">
                    <FormFieldSelect
                      name="incremental_sync_schedule_weekly_weekday"
                      form={optionForm}
                      options={WEEKDAY_OPTIONS}
                      placeholder="Select weekday"
                      style={{ width: 150 }}
                    />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        )}
        {optionForm.formState.incremental_sync_schedule ===
          INCREMENTAL_SYNC_SCHEDULE_ENUM.CRON_EXPRESSION && (
          <Box className="flex flex-col mt-3 pr-6">
            <FormFieldInputNew
              form={optionForm}
              name="incremental_sync_schedule_cron_expression"
              placeholder="* * * * *"
              label="Cron Expression"
              showError={
                !optionForm.formState.incremental_sync_schedule_cron_expression ||
                cronErrorMessage
              }
              errorMessage={
                cronErrorMessage?.replaceAll("Error: ", "") ||
                "This field is required"
              }
            />
            {!cronErrorMessage && <Text className="-mt-4">{cronString}</Text>}
          </Box>
        )}
      </Box>
    );
  }
}

export default IncrementalSyncSchedule;
