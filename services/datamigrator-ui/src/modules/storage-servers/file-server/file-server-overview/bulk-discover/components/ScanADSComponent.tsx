import { Box } from "@components/container/index";
import { RadioButton, Text, Popover } from "@netapp/bxp-design-system-react";
import { ScheduleComponentType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";

const ScanADSComponent = ({ bulkDiscoveryForm, variant }: ScheduleComponentType) => {
  // Show Scan ADS toggle only for SMB protocol 
  const protocol = bulkDiscoveryForm.formState.protocol?.value;
  const isSMB = protocol === "SMB";

  if (!isSMB) {
    return null;
  }
  if(variant === "normal_run") {
    return (
      <Box className="w-4/6">
        <Box className="flex items-center gap-2">
          <Text>Scan Alternate Data Streams (ADS)</Text>
          <Popover>
            Enable this option to scan Alternate Data Streams during discovery.
          </Popover>
        </Box>
        <Text className="flex gap-6 mt-2">
          <RadioButton
            form={bulkDiscoveryForm}
            name="shouldScanADS"
            value="yes"
          >
            Yes
          </RadioButton>
          <RadioButton
            form={bulkDiscoveryForm}
            name="shouldScanADS"
            value="no"
          >
            No
          </RadioButton>
        </Text>
      </Box>
    );
  }
  else {
    return (
      <Box>
        <Box className="flex items-center gap-2 mb-1">
          <Text bold className="!mb-0">Scan Alternate Data Streams (ADS)</Text>
          <Popover placement="right" verticalPlacement="center">
            Enable this option to scan Alternate Data Streams during discovery.
          </Popover>
        </Box>
        <Text className="flex gap-6">
          <RadioButton
            form={bulkDiscoveryForm}
            name="shouldScanADS"
            value="yes"
          >
            Yes
          </RadioButton>
          <RadioButton
            form={bulkDiscoveryForm}
            name="shouldScanADS"
            value="no"
          >
            No
          </RadioButton>
        </Text>
      </Box>
    );
  }
};

export default ScanADSComponent;
