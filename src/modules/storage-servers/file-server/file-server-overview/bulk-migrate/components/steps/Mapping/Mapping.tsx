import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Box } from "@components/container/index";
import { Card, FormFieldSelect, Text } from "@netapp/bxp-design-system-react";
import { useContext, useEffect, useMemo, useState } from "react";
import BulkMigrateScheduleComponent from "./components/BulkMigrateScheduleComponent";
import MountPathConfigurationTable from "./components/MountPathConfigurationTable";
import { getOptionsFromArray } from "@/utils/common.utils";
import { nanoid } from "@reduxjs/toolkit";

const Mapping = () => {
  const {
    sourceFileServerDetails,
    mappingStepForm,
    protocolForm,
    setSelectedMountPathsId,
    setSelectedReviewIds,
  } = useContext(BulkMigrateContext);
  const { setFieldValue } = mappingStepForm;

  const [key, setKey] = useState(nanoid());

  const options = useMemo(() => {
    return getOptionsFromArray(
      sourceFileServerDetails?.fileServers?.map((data) => data.protocol) || [
        "NFS",
        "SMB",
      ]
    );
  }, []);

  useEffect(() => {
    setKey(nanoid());
    setSelectedMountPathsId([]);
    setSelectedReviewIds([]);
    setFieldValue("selectedMountPathsId", []);
  }, [protocolForm.formState.protocol.value]);

  return (
    <>
      <Card className="min-h-24 flex p-4 gap-16">
        <Box>
          <Text>File Server </Text>
          <Text bold>{sourceFileServerDetails?.configName}</Text>
        </Box>
        <BulkMigrateScheduleComponent mappingStepForm={mappingStepForm} />
      </Card>
      <Card className="mt-8 p-6">
        <Box className="w-1/2 pr-6">
          <Text>Select Protocol </Text>
          <FormFieldSelect
            name="protocol"
            form={protocolForm}
            options={options}
            disabled={!sourceFileServerDetails}
          />
        </Box>
      </Card>
      <MountPathConfigurationTable key={key} />
    </>
  );
};

export default Mapping;
