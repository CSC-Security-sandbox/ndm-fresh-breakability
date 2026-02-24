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
import { useContext } from "react";

export const MountPathConfigurationTable = () => {
  const { mappingStepForm, mappingStepTableState } = useContext(BulkMigrateContext);

  const {
    organizedRows,
    pagination,
    columns,
    sortState,
    toggleSort,
    filterState,
    updateFilterState,
    updateTextFilter,
  } = mappingStepTableState;

  const handleTableDownload = () => {
    downloadBulkMigrationCsv(mappingStepForm);
  };

  return (
    <Box className="mb-4">
      <Box className="flex justify-end mx-2 mt-3 mb-1">
        <Box className="flex gap-5 items-center">
          <SearchWidget setFilter={updateTextFilter} />
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
        rows={pagination?.pageRows ?? []}
        sortState={sortState}
        toggleSort={toggleSort}
        filterState={filterState}
        updateFilterState={updateFilterState}
      />
      {pagination && (
        <TablePager
          pageRows={pagination.pageRows ?? []}
          pageSize={10}
          rows={organizedRows ?? []}
          pageIndex={pagination.pageIndex ?? 0}
          pageCount={pagination.pageCount ?? 0}
          gotoPage={pagination.gotoPage ?? (() => {})}
        />
      )}
    </Box>
  );
};

export default MountPathConfigurationTable;
