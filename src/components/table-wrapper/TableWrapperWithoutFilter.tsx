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
import { useEffect } from "react";
import { TableWrapperWithoutFilterPropsType } from "./TableWrapperWithoutFilter.types";

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
  showMenu = true,
}: TableWrapperWithoutFilterPropsType) => {
  // TABLE ATTRIBUTES
  const {
    updateTextFilter,
    organizedRows,
    filterState,
    rows,
    selectionState,
    resetFilters,
    pagination,
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
      {showMenu && (
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
              <SearchWidget
                style={{ width: 360 }}
                setFilter={updateTextFilter}
              />
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
      )}

      <Box className={showMenu ? "" : "my-4"}>
        <Table
          {...tableState}
          rows={pagination?.pageRows}
          selectionState={selectionState}
          isRowDisabled={isRowDisabled}
          isLoading={isLoading}
          rowMenu={rowMenu}
          originalColumns={originalColumns || tableState.columns}
          isTogglingColumns={isTogglingColumns || false}
        />
        {!isLoading && pagination?.pageRows && (
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
    </>
  );
};

export default TableWrapperWithoutFilter;
