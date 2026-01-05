import { Box } from "@components/container/index";
import { RadioButton, Text, Popover } from "@netapp/bxp-design-system-react";
import { ScheduleComponentType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";

const ScanADSComponent = ({ bulkDiscoveryForm }: ScheduleComponentType) => {
  // Show Scan ADS toggle only for SMB protocol 
  const protocol = bulkDiscoveryForm.formState.protocol?.value;
  const isSMB = protocol === "SMB";

  if (!isSMB) {
    return null;
  }

  return (
    <Box className="w-4/6">
      <Box className="flex items-center gap-2">
        <Text>Scan Alternate Data Streams (ADS)</Text>
        <Popover>
          Enable this option to scan NTFS Alternate Data Streams during discovery.
          ADS can contain hidden metadata and additional file information.
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
};

export default ScanADSComponent;
