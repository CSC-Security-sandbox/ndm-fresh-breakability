import {
  TASK_STATUS_TYPE_ENUM,
  TASK_TYPE_TYPE_ENUM,
  WorkerApiType,
} from "@/types/app.type";
import { getGrafanaLogUrl, toTitleCase } from "@/utils/common.utils";
import { useLazyGetJobTasksQuery } from "@api/jobsApi";
import { useGetAllWorkersQuery } from "@api/workersApi";
import { Box } from "@components/container/index";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  Breadcrumbs,
  Button,
  Notification,
  Table,
  TablePager,
  useTable,
  Text,
} from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import TaskFilters from "./TaskFilters";
import { TASKS_COLUMN_DEFS } from "./tasks.constants";
import { BreadcrumbsArrowIcon } from "@netapp/bxp-style/react-icons/Navigation";

const JobTasks = () => {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");

  const { jobId, jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const navigate = useNavigate();
  const [tableRows, setTableRows] = useState([]);
  const [error, setError] = useState();
  const [totalCount, setTotalCount] = useState(0); // Total number of rows will come from the API
  const pageSize = 10; // rows per page
  const pageCount = Math.ceil(totalCount / pageSize);
  const rowsCountArray = Array(totalCount);
  const [getJobTasks, { data: jobTaskData, isFetching: isLoading }] =
    useLazyGetJobTasksQuery();
  const [currentFilters, setCurrentFilters] = useState<any>(
    status ? { status: [{ label: toTitleCase(status), value: status }] } : {}
  );
  const { selectedProjectId } = useSelectedProjectId();
  const { data: workers } = useGetAllWorkersQuery<{
    data: WorkerApiType[];
  }>({
    projectId: selectedProjectId,
  });

  let preSelectedFilter: any = {};
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

  useEffect(() => {
    fetchRecords();
  }, [pagination.pageIndex, sortState, currentFilters]);

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
      await getJobTasks(payload).unwrap();
    } catch (error) {
      console.error({ error, level: "Task listing" });
      if (error?.name === "AbortError") return;
      setError(error);
    }
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
      accessor: "workerName",
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
        <Button onClick={() => navigate("/jobs-list")} variant="text">
          Jobs
        </Button>
        <Button
          onClick={() => navigate(`/job-details/${jobId}`)}
          variant="text"
        >
          Job Details
        </Button>
        <Box className="flex gap-1">
          <Text>Job Run Details</Text>
          <BreadcrumbsArrowIcon
            color="text"
            size="22"
            className="relative top-0.5"
          />
          <Text>Task Details</Text>
        </Box>
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
          rowMenu={rowMenu}
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
