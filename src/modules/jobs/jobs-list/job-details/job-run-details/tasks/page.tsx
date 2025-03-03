"use client";
import { useLazyGetJobTasksQuery } from "@api/jobsApi";
import {
  Table,
  TablePager,
  Notification,
  useTable,
} from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TASKS_COLUMN_DEFS } from "./tasks.constants";
import { Box } from "@components/container/index";
import { Breadcrumbs, Button } from "@netapp/bxp-design-system-react";
import TaskFilters from "./TaskFilters";
import { useNavigate } from "react-router-dom";
import {
  TASK_STATUS_TYPE_ENUM,
  TASK_TYPE_TYPE_ENUM,
  WorkerApiType,
} from "@/types/app.type";
import { useParams, useSearchParams } from "react-router-dom";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { useGetAllWorkersQuery } from "@api/workersApi";
import { toTitleCase } from "@/utils/common.utils";

const Task = () => {
  const { jobId, jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const navigate = useNavigate();
  const [tableRows, setTableRows] = useState([]);
  const [error, setError] = useState();
  const [totalCount, setTotalCount] = useState(0); // Total number of rows will come from the API
  const pageSize = 10; // rows per page
  const pageCount = Math.ceil(totalCount / pageSize);
  const rowsCountArray = Array(totalCount);
  const [getJobTasks, { isLoading }] = useLazyGetJobTasksQuery();
  const [currentFilters, setCurrentFilters] = useState<any>({});
  const { selectedProjectId } = useSelectedProjectId();
  const { data: workers } = useGetAllWorkersQuery<{
    data: WorkerApiType[];
  }>({
    projectId: selectedProjectId,
  });
  const taskAPIRequest = useRef<any | undefined>(""); // instead we should use this but its failing and not returning result QueryActionCreatorResult<any>

  const [searchParams] = useSearchParams();

  const status = searchParams.get("status");
  const taskType = searchParams.get("type");
  let preSelectedFilter: any = {};
  if (status) preSelectedFilter.status = status;
  if (taskType) preSelectedFilter.taskType = taskType;

  const { rowState, pagination, toggleSort, sortState, gotoPage } = useTable({
    columns: TASKS_COLUMN_DEFS,
    pageSize: 1,
    totalCount: 1,
    externalSort: true,
    rows: tableRows,
    isSorting: true,
    defaultSortState: { sortOrder: "desc", column: "createdAt" },
  });

  useEffect(() => {
    fetchRecords();
  }, [pagination.pageIndex, sortState, currentFilters, taskType]);

  const fetchRecords = async () => {
    let payload: any = {
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
          (row: { label: string; value: string }) => row.value
        );
      }
    });

    try {
      setError(undefined);
      await taskAPIRequest.current?.abort();
      taskAPIRequest.current = getJobTasks(payload);

      const result = await taskAPIRequest.current?.unwrap();
      setTableRows(result.data);
      setTotalCount(result.total || 0);
    } catch (error) {
      console.error({ error, level: "Task listing" });
      if (error?.name === "AbortError") return;
      setError(error);
    }
  };

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
      formater: toTitleCase,
    },
    {
      accessor: "taskType",
      label: "Task Type",
      options: Object.values(TASK_TYPE_TYPE_ENUM),
      formater: toTitleCase,
    },
    {
      accessor: "workerId",
      label: "Worker",
      options: workers?.map((row) => row.workerId),
    },
  ];

  return (
    <Box className="flex flex-col gap-6">
      <Breadcrumbs>
        <Button onClick={() => navigate("/jobs-list")} variant="text">
          Jobs
        </Button>
        <Button
          onClick={() => navigate(`/job-details/${jobId}`)}
          variant="text"
        >
          Job Details
        </Button>
        <Box>Job Run Details - Task Details</Box>
      </Breadcrumbs>
      <Box>
        <TaskFilters
          columnsToFilter={columnsToFilter}
          setFilters={setCurrentFilters}
          preSelectedFilter={preSelectedFilter}
        />
        <Table
          isLoading={isLoading}
          headerContainerStyle={{ top: 0 }}
          columns={TASKS_COLUMN_DEFS}
          rows={tableRows}
          sortState={sortState || {}}
          toggleSort={toggleSort}
          rowState={rowState}
          fixedHeight="calc(100vh - 330px)"
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

export default Task;
