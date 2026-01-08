import { Box } from "@components/container/index";
import { RadioButton, Text, Popover } from "@netapp/bxp-design-system-react";
import { ScheduleComponentType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import DateTimePickerWrapper from "@components/date-time-picker-wrapper/DateTimePickerWrapper";

const ScheduleComponent = ({
  bulkDiscoveryForm,
  variant,
}: ScheduleComponentType & { variant?: "normal_run" | "edit_config" 
}) => {
  if(variant === "normal_run") {
    return (
      <Box className="w-4/6">
        <Text>Job Schedule</Text>
        <Text className="flex gap-6">
          <RadioButton
            form={bulkDiscoveryForm}
            name="scheduleTime"
            value="start_now"
          >
            Start Now
          </RadioButton>
          <RadioButton
            form={bulkDiscoveryForm}
            name="scheduleTime"
            value="schedule_date"
          >
            Schedule Date & Time (UTC)
          </RadioButton>
        </Text>
        {bulkDiscoveryForm.formState.scheduleTime === "schedule_date" && (
          <Box className="flex gap-3 mt-3">
            <DateTimePickerWrapper bulkDiscoveryForm={bulkDiscoveryForm} />
          </Box>
        )}
      </Box>
    );
  }
else {
  return (
    <Box>
      <Box className="flex gap-2 items-center mb-1">
        <Text bold className="!mb-0">Job Schedule</Text>
        <Popover placement="right" verticalPlacement="center">
          Schedule a job run for a specific date & time
        </Popover>
      </Box>
      <Box>
        <Text className="flex gap-6">
          <RadioButton
            form={bulkDiscoveryForm}
            name="scheduleTime"
            value="schedule_date"
          >
            Schedule Date & Time (UTC)
          </RadioButton>
        </Text>
        {bulkDiscoveryForm.formState.scheduleTime === "schedule_date" && (
          <Box className="flex gap-3 mt-3">
            <DateTimePickerWrapper bulkDiscoveryForm={bulkDiscoveryForm} />
          </Box>
        )}
      </Box>
    </Box>
    );
  };
};

export default ScheduleComponent;
