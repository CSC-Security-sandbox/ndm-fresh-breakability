import UserWarning from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/UserWarning";
import { BulkCutOverContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/context/BulkCutOverContextProvider";
import { Box } from "@components/container/index";
import TableWrapperWithoutFilter from "@components/table-wrapper/TableWrapperWithoutFilter";
import { Card, CardContent, Text } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { SELECT_PATH_WARNING_MESSAGE } from "./selectPath.constant";

const SelectPath = () => {
  const {
    BulkCutOverForm,
    fileServerDetails,
    selectPathTableState,
    setCutOverSelectedIds,
  } = useContext(BulkCutOverContext);

  return (
    <>
      <Card>
        <CardContent className="flex gap-4 flex-col">
          <Text>Source File Server</Text>
          <Box className="text-sm font-semibold">
            {fileServerDetails?.configName}
          </Box>
        </CardContent>
      </Card>

      <TableWrapperWithoutFilter
        tableState={selectPathTableState}
        isLoading={false}
        handleSelection={setCutOverSelectedIds}
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
