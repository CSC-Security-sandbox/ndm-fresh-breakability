import { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { downloadBulkMigrationCsv } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Box } from "@mui/material";
import {
  Button,
  SearchWidget,
  Table,
  TablePager,
} from "@netapp/bxp-design-system-react";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { useContext, useEffect } from "react";
import RefreshButton from "@/components/refresh-button/RefreshButton";

export const MountPathConfigurationTable = () => {
  const {
    mappingStepForm,
    setSelectedMountPathsId,
    selectedMountPathsId,
    setSelectedReviewIds,
    mappingStepTableState,
    listOfNotReachableExportPaths,
    sourceDisabledPaths,
    refetch,
    isFetching,
  } = useContext(BulkMigrateContext);

  const { setFieldValue } = mappingStepForm;
  const {
    organizedRows,
    pagination,
    columns,
    sortState,
    toggleSort,
    filterState,
    updateFilterState,
    updateTextFilter,
    toggleRowSelection,
    selectionState,
  } = mappingStepTableState;

  useEffect(() => {
    const selectedRows = Object.keys(selectionState.rows).filter(
      (key) => selectionState.rows[key] === true
    );
    setSelectedMountPathsId(selectedRows);
    setSelectedReviewIds(selectedRows?.map((row, key) => key.toString())); // pre-selecting all the paths that are selected at first step.
    setFieldValue("selectedMountPathsId", selectedRows);
  }, [selectionState?.count]);

  const handleTableDownload = () => {
    downloadBulkMigrationCsv(mappingStepForm);
  };
  const checkDisabled = (row: MigrationDetailsTableConfigurationType) => {
    return (
      listOfNotReachableExportPaths.includes(row?.sourcePath?.sourcePathId) ||
      sourceDisabledPaths.includes(row?.sourcePath?.sourcePathId)
    );
  };

  return (
    <Box className="mb-4">
      <Box className="flex justify-end mx-2 mt-3 mb-1">
        <Box className="flex gap-5 items-center">
          <SearchWidget setFilter={updateTextFilter} />
          <RefreshButton isLoading={isFetching} onRefresh={refetch} />
          <Button
            variant="icon"
            disabled={pagination?.pageRows === undefined}
            onClick={handleTableDownload}
          >
            <DownloadMonochromeIcon onClick={handleTableDownload} />
          </Button>
        </Box>
      </Box>

      <Table
        columns={columns}
        rows={pagination?.pageRows}
        sortState={sortState}
        toggleSort={toggleSort}
        filterState={filterState}
        updateFilterState={updateFilterState}
        toggleRowSelection={toggleRowSelection}
        selectionState={selectionState}
        isRowDisabled={checkDisabled}
      />
      {pagination?.pageRows && (
        <TablePager
          pageRows={pagination?.pageRows}
          pageSize={10}
          rows={organizedRows}
          pageIndex={pagination?.pageIndex}
          pageCount={pagination?.pageCount}
          gotoPage={pagination?.gotoPage}
        />
      )}
    </Box>
  );
};

export default MountPathConfigurationTable;
