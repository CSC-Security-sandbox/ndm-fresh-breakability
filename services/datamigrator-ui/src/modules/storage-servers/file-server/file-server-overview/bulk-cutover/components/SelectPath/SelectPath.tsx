import UserWarning from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/UserWarning";
import { BulkCutOverContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";
import { Box } from "@components/container/index";
import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";
import { Card, CardContent, Text } from "@netapp/bxp-design-system-react";
import { useContext, useMemo } from "react";
import { SELECT_PATH_WARNING_MESSAGE } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/SelectPath/selectPath.constant";

const SelectPath = () => {
  const {
    BulkCutOverForm,
    fileServerDetails,
    selectPathTableState,
    setCutOverSelectedIds,
    isCutOverPathsFetching,
    refetchCutOverPaths,
  } = useContext(BulkCutOverContext);

  const sourceFileServerDisplayName = useMemo(() => {
    if (!fileServerDetails?.configName) return "";
    
    const configName = fileServerDetails.configName;
    const serverType = fileServerDetails?.serverType || fileServerDetails?.configType;
    const fileServerName = fileServerDetails?.fileServers?.[0]?.fileServerName;
    
    // If not OtherNAS and has a zone/fileServerName, show configName:fileServerName
    if (serverType && serverType !== "OtherNAS" && fileServerName) {
      return `${configName}:${fileServerName}`;
    }
    
    return configName;
  }, [fileServerDetails]);

  return (
    <>
      <Card>
        <CardContent className="flex gap-4 flex-col">
          <Text bold>Source File Server</Text>
          <Box className="text-sm">
            {sourceFileServerDisplayName}
          </Box>
        </CardContent>
      </Card>

      <TableWrapperWithoutFilter
        tableState={selectPathTableState}
        isLoading={false}
        handleSelection={setCutOverSelectedIds}
        refetchTableData={refetchCutOverPaths}
        isRefreshing={isCutOverPathsFetching}
      />

      <UserWarning
        form={BulkCutOverForm}
        controlName="isSelectPathConformed"
        warningMessage={SELECT_PATH_WARNING_MESSAGE}
      />
    </>
  );
};

export default SelectPath;
