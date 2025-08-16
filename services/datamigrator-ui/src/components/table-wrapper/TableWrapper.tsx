/* eslint-disable */
import Box from "@components/container/Box";
import {
  Button,
  SearchWidget,
  Table,
  TableCounter,
  TablePager,
  useTable,
} from "@netapp/bxp-design-system-react";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import React, { useEffect, useState } from "react";
import Filters from "@components/table-wrapper/Filters";
import { TableWrapperPropsType } from "@components/table-wrapper/TableWrapper.types";
import RefreshButton from "@components/refresh-button/RefreshButton";

const TableWrapper = ({
  tableStateProps,
  rowMenu,
  isLoading,
  content,
  showDownload,
  label,
  isTogglingColumns,
  originalColumns,
  showFilters,
  columnsToFilter,
  isRowDisabled,
  showLabel = true,
  preSelectedFilter,
  handleSelection,
  secondaryLabel,
  isRefreshing,
  refetchTableData,
  notReachableExportPaths = [],
  noDataLabel = "No Data",
}: TableWrapperPropsType) => {
  const [currentFilters, setCurrentFilters] = useState<any>({});
  const [organizedRowsFiltered, setOrganizedRowsFiltered] = useState<any[]>(
    tableStateProps.rows || []
  );

  useEffect(() => {
    const data = tableStateProps.rows || [];
    const filteredRows = [...data].filter((row: any) => {
      return (
        columnsToFilter === undefined ||
        columnsToFilter?.every(({ accessor }) => {
          return (
            currentFilters[accessor] === (undefined || null) ||
            currentFilters[accessor]?.length === 0 ||
            currentFilters[accessor]?.find(
              ({ value }: any) => value === row[accessor].toString()
            )
          );
        })
      );
    });
    setOrganizedRowsFiltered(filteredRows);
  }, [currentFilters, tableStateProps.rows]);

  const tableState = useTable({
    ...tableStateProps,
    rows: organizedRowsFiltered,
  });

  // TABLE ATTRIBUTES
  const {
    updateTextFilter,
    filterState,
    rows,
    selectionState,
    resetFilters,
    pagination,
    updateRowState,
    rowState,
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

      handleSelection(selectedRows, tableState?.rows || []);
    }
  }, [tableState?.selectionState?.count]);

  const checkDisabled = (row) => {
    return notReachableExportPaths.includes(row?.id);
  };

  return (
    <Box>
      {showFilters && (
        <Filters
          rows={tableStateProps.rows || []}
          columnsToFilter={columnsToFilter}
          setFilters={setCurrentFilters}
          preSelectedFilter={preSelectedFilter}
          gotoPage={pagination?.gotoPage}
        />
      )}
      <Box
        className={`p-2 flex gap-4 ${
          showLabel ? "justify-between" : "justify-end"
        }`}
      >
        {showLabel && (
          <Box className="flex gap-2 items-center">
            <TableCounter
              filteredCount={organizedRowsFiltered?.length}
              activeFiltersCount={getFilterCount()}
              totalCount={rows?.length}
              selectedCount={selectionState?.count}
              pluralLabel={label || "Rows"}
              singularLabel={label || "Row"}
              onResetFilter={resetFilters}
            />
            <Box className="inline-flex items-center text-[#404040] text-[16px] font-[590] leading-[28px]">
              {secondaryLabel}
            </Box>
          </Box>
        )}
        <Box className="flex gap-5 items-center">
          <SearchWidget
            setFilter={updateTextFilter}
            className="w-[360px] mt-1"
          />

          <RefreshButton
            isLoading={isRefreshing}
            onRefresh={refetchTableData}
          />

          {showDownload && (
            <Button variant="icon" className="w-[18px] h-[18px]">
              <DownloadMonochromeIcon />
            </Button>
          )}
          {content}
        </Box>
      </Box>

      <Box>
        <Table
          {...tableState}
          rows={pagination?.pageRows}
          rowState={rowState}
          updateRowState={updateRowState}
          selectionState={selectionState}
          isRowDisabled={checkDisabled}
          isLoading={isRefreshing || isLoading}
          rowMenu={rowMenu}
          originalColumns={originalColumns || tableState.columns}
          isTogglingColumns={isTogglingColumns || false}
          noDataLabel={noDataLabel}
        />
        {!isLoading && pagination?.pageRows && (
          <TablePager
            pageRows={pagination?.pageRows}
            pageSize={10}
            rows={organizedRowsFiltered}
            pageIndex={pagination?.pageIndex}
            pageCount={pagination?.pageCount}
            gotoPage={pagination?.gotoPage}
          />
        )}
      </Box>
    </Box>
  );
};

export default React.memo(TableWrapper);
