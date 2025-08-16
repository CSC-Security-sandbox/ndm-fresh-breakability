import { Box } from "@components/container/index";
import {
  FormFieldInputNew,
  Text,
  Popover,
} from "@netapp/bxp-design-system-react";
import { useContext, useMemo, useState } from "react";
import ScheduleOptions from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/ScheduleOptions/ScheduleOptions";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { isValidCron } from "cron-validator";
import cronstrue from "cronstrue";
import {
  INCREMENTAL_SYNC_SCHEDULE_ENUM,
  INCREMENTAL_SYNC_SCHEDULE_OPTIONS,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/IncrementalSyncSchedule/incremental-sync-schedule.constants";
import RadioButtonGroup from "@components/radio-button/RadioButtonGroup";

const IncrementalSyncSchedule = () => {
  const { optionForm } = useContext(BulkMigrateContext);
  const [cronErrorMessage, setCronErrorMessage] = useState<string>();
  const { incremental_sync_schedule_cron_expression } = optionForm.formState;

  const cronString = useMemo(() => {
    setCronErrorMessage("");
    if (!incremental_sync_schedule_cron_expression) {
      optionForm.formState.incremental_sync_schedule_cron_expression_error = "";
      return "";
    }
    try {
      optionForm.formState.incremental_sync_schedule_cron_expression_error = "";

      if (!isValidCron(incremental_sync_schedule_cron_expression)) {
        throw new Error("Invalid cron expression");
      }
      /* 
        Convert cron expression to a human-readable string
        using cronstrue library
        */
      const readable = cronstrue.toString(
        incremental_sync_schedule_cron_expression
      );
      return readable;
    } catch (error) {
      setCronErrorMessage(
        (error as Error).message || "Failed to validate cron expression"
      );
      optionForm.formState.incremental_sync_schedule_cron_expression_error = (
        error as Error
      ).message;
      return "";
    }
  }, [incremental_sync_schedule_cron_expression]);

  return (
    <Box className="w-5/6">
      <Box className="flex gap-1 items-center mb-2">
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
};

export default IncrementalSyncSchedule;
