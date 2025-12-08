import { Box } from "@components/container/index";
import {
  Card,
  FormFieldTextArea,
  Text,
  Popover,
} from "@netapp/bxp-design-system-react";
import React from "react";
import { TopSectionPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import ScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/components/ScheduleComponent";

const TopSection = ({
  fileServerDetails,
  bulkDiscoveryForm,
}: TopSectionPropsType) => {
  return (
    <Card>
      <Box className="p-6 flex">
        <Box className="w-3/6 flex flex-col gap-4">
          <Box>
            <Text>File Server </Text>
            <Text bold>{fileServerDetails?.configName}</Text>
          </Box>
          <ScheduleComponent bulkDiscoveryForm={bulkDiscoveryForm} variant="normal_run" />
        </Box>
        <Box className="w-3/6">
          <FormFieldTextArea
            form={bulkDiscoveryForm}
            placeholder="Excluded Path Patterns"
            name="excludeFilePatterns"
            label="Excluded Path Patterns"
            isOptional
            labelChildren={
              <Popover>Mention file patterns that should be excluded</Popover>
            }
          />
        </Box>
      </Box>
    </Card>
  );
};

export default React.memo(TopSection);
