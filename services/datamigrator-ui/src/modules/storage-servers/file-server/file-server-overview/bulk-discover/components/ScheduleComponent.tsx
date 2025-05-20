import { Box } from "@components/container/index";
import { RadioButton, Text } from "@netapp/bxp-design-system-react";
import { ScheduleComponentType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import DateTimePickerWrapper from "@components/date-time-picker-wrapper/DateTimePickerWrapper";

const ScheduleComponent = ({ bulkDiscoveryForm }: ScheduleComponentType) => {
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
};

export default ScheduleComponent;
