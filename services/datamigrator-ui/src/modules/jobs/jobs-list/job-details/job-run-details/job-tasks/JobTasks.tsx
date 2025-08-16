import { TASK_STATUS_TYPE_ENUM, TASK_TYPE_TYPE_ENUM } from "@/types/app.type";
import { getGrafanaLogUrl, toTitleCase } from "@/utils/common.utils";
import { useGetJobTasksQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import useFetchWorkers from "@hooks/useFetchWorkers";
import TaskFilters from "@modules/jobs/jobs-list/job-details/job-run-details/job-tasks/TaskFilters";
import { TASKS_COLUMN_DEFS } from "@modules/jobs/jobs-list/job-details/job-run-details/job-tasks/tasks.constants";
import {
  Breadcrumbs,
  Notification,
  Table,
  TablePager,
  useTable,
} from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { SerializedError } from "@reduxjs/toolkit";
import RefreshButton from "@components/refresh-button/RefreshButton";

const JobTasks = () => {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");
  const jobTasksCount = Number(searchParams.get("count"));
  const { jobId, jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const [tableRows, setTableRows] = useState([]);
  const [error, setError] = useState<FetchBaseQueryError | SerializedError>();
  const [totalCount, setTotalCount] = useState(0); // Total number of rows will come from the API
  const pageSize = 10; // rows per page
  const pageCount = Math.ceil(totalCount / pageSize);
  const rowsCountArray = Array(totalCount);
  const [taskPayload, setTaskPayload] = useState<Record<string, string>>({});
  const [currentFilters, setCurrentFilters] = useState<any>(
    status ? { status: [{ label: toTitleCase(status), value: status }] } : {}
  );
  const { workers } = useFetchWorkers();

  const preSelectedFilter: any = {};
  if (status) preSelectedFilter.status = status;

  const { rowState, pagination, toggleSort, sortState, gotoPage } = useTable({
    columns: TASKS_COLUMN_DEFS,
    pageSize: 1,
    totalCount: 1,
    externalSort: true,
    rows: tableRows,
    isSorting: true,
    defaultSortState: { sortOrder: "desc", column: "createdAt" },
  });

  const fetchRecords = async () => {
    const payload: any = {
      page: 1,
      jobRunId,
      limit: pageSize,
      sort: sortState.column,
      order: sortState.sortOrder,
    };

    if (typeof pagination.pageIndex === "number") {
      payload.page = pagination.pageIndex + 1;
    }

    Object.keys(currentFilters).forEach((key: string) => {
      if (currentFilters[key].length > 0) {
        payload[key] = currentFilters[key].map(
          (row: { label: string; value: string }) => {
            return key === "workerId" ? getWorkersId(row.label) : row.value;
          }
        );
      }
    });
    setTaskPayload(payload);
  };

  const {
    data: jobTaskData,
    isFetching: isLoading,
    refetch,
    error: jobTaskError,
  } = useGetJobTasksQuery(taskPayload, {
    skip: !jobRunId || !taskPayload?.jobRunId,
  });

  useEffect(() => {
    if (jobRunId) {
      fetchRecords();
    }
  }, [pagination?.pageIndex, sortState, currentFilters, jobRunId]);

  useEffect(() => {
    if (jobTaskError) {
      if (jobTaskError?.name === "AbortError") return;
      setError(jobTaskError);
    }
  }, [jobTaskError]);

  const getWorkersId = (workerName: string) => {
    return workers?.find((row) => row.workerName === workerName)?.workerId;
  };

  useEffect(() => {
    if (jobTaskData) {
      //Adding workerName to the tasks data
      const allTasks = jobTaskData.data.map((eachTask) => {
        const workerName =
          workers?.find((row) => row.workerId === eachTask.workerId)
            ?.workerName || eachTask.workerId;
        return { ...eachTask, workerName };
      });
      setTableRows(allTasks);
      setTotalCount(jobTaskData.total || 0);
    }
  }, [jobTaskData, workers]);

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
    [tableRows]
  );

  const columnsToFilter = [
    {
      accessor: "status",
      label: "Status",
      options: Object.values(TASK_STATUS_TYPE_ENUM),
      formatter: toTitleCase,
    },
    {
      accessor: "taskType",
      label: "Task Type",
      options: Object.values(TASK_TYPE_TYPE_ENUM),
      formatter: toTitleCase,
    },
    {
      accessor: "workerId",
      label: "Worker",
      options: workers?.map((row) => row.workerName),
    },
  ];

  const rowMenu = (row: any) => {
    const viewLogUrl = getGrafanaLogUrl(row.id);

    return [
      {
        label: "View Logs",
        onClick: () => {
          window.open(viewLogUrl, "_blank");
        },
      },
    ];
  };

  return (
    <Box className="flex flex-col gap-6">
      <Breadcrumbs>
        <Link to="/jobs-list">Jobs</Link>
        <Link to={`/job-details/${jobId}`}>Job Details</Link>
        <Link to={`/job-details/${jobId}/run/${jobRunId}`}>
          Job Run Details
        </Link>
        <Box>Task Details</Box>
      </Breadcrumbs>

      <Box>
        <TaskFilters
          columnsToFilter={columnsToFilter}
          setFilters={setCurrentFilters}
          preSelectedFilter={preSelectedFilter}
        />
        <Box className="flex justify-end m-2">
          <RefreshButton isLoading={isLoading} onRefresh={refetch} />
        </Box>
        <Table
          isLoading={isLoading}
          headerContainerStyle={{ top: 0 }}
          columns={TASKS_COLUMN_DEFS}
          rows={tableRows}
          sortState={sortState || {}}
          toggleSort={toggleSort}
          rowState={rowState}
          fixedHeight="calc(100vh - 330px)"
          // rowMenu={rowMenu}
          {...(jobTasksCount > 0 && {
            noDataLabel: import.meta.env.VITE_REFRESH_TO_GET_LATEST_DATA,
          })}
        />
        {tableRows.length > 0 && totalCount >= tableRows.length && (
          <Box>{RenderTablePager}</Box>
        )}
      </Box>
      <Box>
        {error && (
          <Notification type="error" moreInfo={error?.data?.message || ""}>
            There seem to be a problem with the fetching Task data.
          </Notification>
        )}
      </Box>
    </Box>
  );
};

export default JobTasks;
