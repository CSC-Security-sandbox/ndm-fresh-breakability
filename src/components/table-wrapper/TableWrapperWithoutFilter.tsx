/* eslint-disable */
import Box from "@components/container/Box";
import {
  Button,
  SearchWidget,
  Table,
  TableCounter,
  TableWidgets,
} from "@netapp/bxp-design-system-react";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { ReactNode, useEffect } from "react";

const TableWrapperWithoutFilter = ({
  tableState,
  rowMenu,
  isLoading,
  content,
  showDownload,
  label,
  isTogglingColumns,
  originalColumns,
  isRowDisabled,
  handleSelection,
}: {
  tableState: any;
  rowMenu?: any;
  isLoading?: any;
  content?: ReactNode;
  showDownload?: Boolean;
  label?: string;
  isTogglingColumns?: Boolean;
  originalColumns?: any;
  isRowDisabled?: (arg: any) => void;
  handleSelection?: Function;
}) => {
  // TABLE ATTRIBUTES
  const {
    updateTextFilter,
    organizedRows,
    filterState,
    rows,
    selectionState,
    resetFilters,
  } = tableState;

  const getFilterCount = () => {
    let filterCount = 0;
    Object.keys(filterState.columns).forEach((column: any) => {
      if (filterState.columns[column].activeCount > 0) {
        filterCount++;
      }
    });
    return filterCount;
  };

  useEffect(() => {
    if (handleSelection) {
      const selectedRows = Object.keys(tableState?.selectionState.rows).filter(
        (key) => tableState?.selectionState.rows[key] === true
      );

      handleSelection(selectedRows);
    }
  }, [tableState?.selectionState?.count]);

  return (
    <>
      <Box className="p-2 flex gap-4 justify-between">
        <Box className="flex gap-2 items-center">
          <TableCounter
            filteredCount={organizedRows.length}
            activeFiltersCount={getFilterCount()}
            totalCount={rows.length}
            selectedCount={selectionState?.count}
            pluralLabel={label || "Rows"}
            singularLabel={label || "Row"}
            onResetFilter={resetFilters}
          />
        </Box>

        <Box className="flex gap-2 items-center">
          <TableWidgets style={{}}>
            <SearchWidget style={{ width: 360 }} setFilter={updateTextFilter} />
            {showDownload && (
              <Button
                variant="icon"
                style={{ margin: 20 }}
                onClick={() => alert("DOWNLOAD CALLED")}
              >
                <DownloadMonochromeIcon />
              </Button>
            )}
          </TableWidgets>
          {content}
        </Box>
      </Box>

      <Table
        {...tableState}
        rows={organizedRows}
        selectionState={selectionState}
        isRowDisabled={isRowDisabled}
        isLoading={isLoading}
        rowMenu={rowMenu}
        originalColumns={originalColumns || tableState.columns}
        isTogglingColumns={isTogglingColumns || false}
      />
    </>
  );
};

export default TableWrapperWithoutFilter;
