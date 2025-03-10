import { BULK_MIGRATION_MOUNT_PATH_COL_DEFS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";
import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import {
  createSelectedMountPathsObject,
  downloadBulkMigrationCsv,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { BlueXpTableStateType } from "@/types/app.type";
import { Box, Button } from "@mui/material";
import { SearchWidget, Table, useTable } from "@netapp/bxp-design-system-react";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { useContext, useEffect, useState } from "react";
import UploadMappingTableDetails from "./UploadMappingTableDetails";

export const MountPathConfigurationTable = () => {
  const {
    mappingStepForm,
    setSelectedMountPathsId,
    selectedMountPathsId,
    setSelectedReviewIds,
    protocolForm,
  } = useContext(BulkMigrateContext);

  const { setFieldValue } = mappingStepForm;

  const {
    organizedRows,
    columns,
    sortState,
    toggleSort,
    filterState,
    updateFilterState,
    updateTextFilter,
    toggleRowSelection,
    selectionState,
  }: BlueXpTableStateType<any> = useTable({
    columns: BULK_MIGRATION_MOUNT_PATH_COL_DEFS,
    rows: mappingStepForm?.values?.migrationDetailsTableConfigurationValue?.filter(
      (row) => row.protocol === protocolForm.formState.protocol.value
    ),
    isSorting: true,
    isRowSelecting: true,
    defaultSelectionState: {
      rows: createSelectedMountPathsObject(
        mappingStepForm?.values?.selectedMountPathsId
      ),
    },
  });

  useEffect(() => {
    const selectedRows = Object.keys(selectionState.rows).filter(
      (key) => selectionState.rows[key] === true
    );
    setSelectedMountPathsId(selectedRows);
    setSelectedReviewIds(selectedRows?.map((row, key) => key.toString())); // pre-selecting all the paths that are selected at first step.
    setFieldValue("selectedMountPathsId", selectedRows);
  }, [selectionState?.count]);

  const checkDisabled = (row: MigrationDetailsTableConfigurationType) => {
    return !selectedMountPathsId.includes(row.id.toString());
  };

  const handleTableDownload = () => {
    downloadBulkMigrationCsv(mappingStepForm);
  };

  return (
    <Box>
      <Box className="flex justify-end my-3">
        <Box className="flex gap-3 items-center">
          <Box className="flex-grow">
            {/* FILE UPLOADER */}
            <UploadMappingTableDetails
              toggleRowSelection={toggleRowSelection}
            />
          </Box>
          <SearchWidget setFilter={updateTextFilter} />
          <Button variant="icon" onClick={handleTableDownload}>
            <DownloadMonochromeIcon />
          </Button>
        </Box>
      </Box>

      <Table
        columns={columns}
        rows={organizedRows}
        sortState={sortState}
        toggleSort={toggleSort}
        filterState={filterState}
        updateFilterState={updateFilterState}
        toggleRowSelection={toggleRowSelection}
        selectionState={selectionState}
        isRowDisabled={checkDisabled}
      />
    </Box>
  );
};

export default MountPathConfigurationTable;
