import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Box } from "@components/container/index";
import {
  Card,
  FormFieldInputNew,
  FormFieldSelect,
  Text,
} from "@netapp/bxp-design-system-react";
import { useContext, useEffect, useMemo, useState } from "react";
import BulkMigrateScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/BulkMigrateScheduleComponent";
import MountPathConfigurationTable from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/MountPathConfigurationTable";
import { getOptionsFromArray } from "@/utils/common.utils";
import { nanoid } from "@reduxjs/toolkit";
import UploadMappingTableDetails from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/UploadMappingTableDetails";

const Mapping = () => {
  const {
    sourceFileServerDetails,
    mappingStepForm,
    protocolForm,
    setSelectedMountPathsId,
    setSelectedReviewIds,
    mappingStepTableState,
    fileName,
  } = useContext(BulkMigrateContext);
  const { setFieldValue } = mappingStepForm;

  const [key, setKey] = useState(nanoid());

  const sourceFileServerDisplayName = useMemo(() => {
    if (!sourceFileServerDetails?.configName) return "";
    
    const configName = sourceFileServerDetails.configName;
    const serverType = sourceFileServerDetails?.serverType || sourceFileServerDetails?.configType;
    const fileServerName = sourceFileServerDetails?.fileServers?.[0]?.fileServerName;
    
    // If not OtherNAS and has a zone/fileServerName, show configName:fileServerName
    if (serverType && serverType !== "OtherNAS" && fileServerName) {
      return `${configName}:${fileServerName}`;
    }
    
    return configName;
  }, [sourceFileServerDetails]);

  const options = useMemo(() => {
    const _options = getOptionsFromArray(
      sourceFileServerDetails?.fileServers?.map((data) => data.protocol) || [
        "NFS",
        "SMB",
      ]
    );
    protocolForm.resetForm({ protocol: _options[0] });
    return _options;
  }, [sourceFileServerDetails?.fileServers?.length]);

  useEffect(() => {
    setKey(nanoid());
    setSelectedMountPathsId([]);
    setSelectedReviewIds([]);
    setFieldValue("selectedMountPathsId", []);
  }, [protocolForm.formState.protocol.value]);

  return (
    <>
      <Card className="min-h-24 flex p-6 justify-between">
        <Box>
          <Text>Source File Server</Text>
          <Text bold>{sourceFileServerDisplayName}</Text>
        </Box>
        <BulkMigrateScheduleComponent mappingStepForm={mappingStepForm} variant="normal_run" />
      </Card>
      <Card className="mt-2 p-6 flex flex-col">
        <Text>Table mapping</Text>
        <Box className="flex flex-grow gap-8 pt-4">
          <FormFieldSelect
            name="protocol"
            form={protocolForm}
            options={options}
            disabled={!sourceFileServerDetails}
            className="w-1/2"
          />
          <FormFieldInputNew
            name="uploadFile"
            value={fileName}
            readOnly
            placeholder="Upload Source to Destination Mapping"
            inputButtons={
              <UploadMappingTableDetails
                toggleRowSelection={mappingStepTableState?.toggleRowSelection}
              />
            }
          />
        </Box>
      </Card>
      <MountPathConfigurationTable key={key} />
    </>
  );
};

export default Mapping;
