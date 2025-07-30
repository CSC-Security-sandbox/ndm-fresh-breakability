import { useGetJobRunErrorsQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import { ERROR_COLUMN_DEF } from "@modules/jobs/job-task-errors/jobTaskErrors.constant";
import { ErrorsListTablePropsType } from "@modules/jobs/job-task-errors/JobTaskErrorsTabs.interface";
import { Table, TablePager, useTable } from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { JobErrorType } from "@/types/app.type";
import RefreshButton from "@components/refresh-button/RefreshButton";

const pageSize = 10;
const ErrorsListTable = ({ currentErrorType }: ErrorsListTablePropsType) => {
  const { jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const [tableRows, setTableRows] = useState<JobErrorType[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const pageCount = Math.ceil(totalCount / pageSize);
  const rowsCountArray = Array(totalCount);

  const { rowState, pagination, toggleSort, sortState, gotoPage } = useTable({
    columns: ERROR_COLUMN_DEF,
    pageSize: 1,
    externalSort: true,
    rows: tableRows,
    isSorting: true,
    defaultSortState: { sortOrder: "desc", column: "createdAt" },
  });

  const queryParams = `page=${
    pagination?.pageIndex + 1
  }&limit=${pageSize}&sort=createdAt&order=DESC&jobRunId=${jobRunId}&errorType=${currentErrorType}`;

  const {
    data: errorDetails,
    isLoading,
    refetch,
    isFetching,
  } = useGetJobRunErrorsQuery(queryParams);

  useEffect(() => {
    if (errorDetails) {
      setTableRows(errorDetails?.data);
      setTotalCount(errorDetails?.total || 0);
    }
  }, [errorDetails, pagination?.pageIndex, sortState, currentErrorType]);

  const RenderTablePager = useMemo(
    () => (
      <TablePager
        pageRows={tableRows || []}
        pageSize={pageSize}
        rows={rowsCountArray}
        pageIndex={pagination.pageIndex}
        pageCount={pageCount}
        gotoPage={gotoPage}
      />
    ),
    [tableRows, pagination?.pageIndex, pageCount, rowsCountArray]
  );

  return (
    <Box className="flex flex-col gap-4">
      <Box className="flex justify-end p-2">
        <RefreshButton isLoading={isFetching} onRefresh={refetch} />
      </Box>
      <Box>
        <Table
          isLoading={isFetching || isLoading}
          columns={ERROR_COLUMN_DEF}
          rows={tableRows}
          sortState={sortState || {}}
          toggleSort={toggleSort}
          rowState={rowState}
        />
        {tableRows?.length > 0 && totalCount >= tableRows?.length && (
          <Box>{RenderTablePager}</Box>
        )}
      </Box>
    </Box>
  );
};

export default ErrorsListTable;
