import {
  useGetJobRunErrorsMutation,
  useLazyGetJobRunErrorsOverviewQuery,
} from "@api/jobsApi";
import { Box } from "@components/container/index";
import { ERROR_COLUMN_DEF } from "@modules/jobs/job-task-errors/jobTaskErrors.constant";
import { ErrorsListTablePropsType } from "@modules/jobs/job-task-errors/JobTaskErrorsTabs.interface";
import { Table, TablePager, useTable } from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { notify } from "@components/notification/NotificationWrapper";
import { JobErrorType, JobRunErrorsApiType } from "@/types/app.type";

const pageSize = 10;
const ErrorsListTable = ({ currentErrorType }: ErrorsListTablePropsType) => {
  const { jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const [tableRows, setTableRows] = useState<JobErrorType[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const pageCount = Math.ceil(totalCount / pageSize);
  const rowsCountArray = Array(totalCount);
  const [getJobRunErrorsApi, { isLoading }] = useGetJobRunErrorsMutation();
  useLazyGetJobRunErrorsOverviewQuery();

  const { rowState, pagination, toggleSort, sortState, gotoPage } = useTable({
    columns: ERROR_COLUMN_DEF,
    pageSize: 1,
    totalCount: 1,
    externalSort: true,
    rows: tableRows,
    isSorting: true,
    defaultSortState: { sortOrder: "desc", column: "createdAt" },
  });

  useEffect(() => {
    (async () => {
      const queryParams: string = `page${1}&limit=10&sort=createdAt&order=DESC&jobRunId=${jobRunId}&errorType=${currentErrorType}`;
      try {
        const _errorDetails: JobRunErrorsApiType = await getJobRunErrorsApi(
          queryParams
        ).unwrap();
        setTableRows(_errorDetails.data);
        setTotalCount(_errorDetails.total || 0);
      } catch (error) {
        notify.error("Something went wrong.");
        console.error({ error, level: "error listing" });
      }
    })();
  }, [pagination.pageIndex, sortState, currentErrorType]);

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
    <Box className="flex flex-col gap-6">
      <Box>
        <Table
          isLoading={isLoading}
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
