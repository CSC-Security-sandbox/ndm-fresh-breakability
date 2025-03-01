import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Box } from "@components/container/index";
import { Card, Text } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import BulkMigrateScheduleComponent from "./components/BulkMigrateScheduleComponent";
import MountPathConfigurationTable from "./components/MountPathConfigurationTable";

const Mapping = () => {
  const { sourceFileServerDetails, mappingStepForm } =
    useContext(BulkMigrateContext);

  return (
    <>
      <Card className="min-h-24 flex p-4 gap-16">
        <Box>
          <Text>File Server </Text>
          <Text bold>{sourceFileServerDetails?.configName}</Text>
        </Box>
        <BulkMigrateScheduleComponent mappingStepForm={mappingStepForm} />
      </Card>
      <MountPathConfigurationTable />
    </>
  );
};

export default Mapping;
