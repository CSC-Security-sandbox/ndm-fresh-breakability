import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { hasPermission } from "@auth/auth.utils";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  useGetJobConfigsQuery,
  useUpdateJobStatusMutation,
  jobsApi,
} from "@api/jobsApi";
import { JOB_CONFIG_STATUS_ENUM } from "@/types/app.type";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  COLUMNS_TO_FILTER_DEFS,
  defaultColumnState,
  JOB_LIST_COLUMN_DEFS,
  preSelectedFilterType,
} from "./job-listing.constant";
import { getJobListFlaternList } from "./listing.utils";
import { useDispatch } from "react-redux";
// import useRefresh from "@hooks/useRefresh";
// import { RefreshTable } from "@components/table-wrapper/RefreshTable";
import RefreshTableData from "@components/table-wrapper/RefreshTableData";

// import useRefresh from "src/components/table-wrapper/useRefresh";

const JobsList = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageJob: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageJob
  );

  const source = searchParams.get("source");
  const jobType = searchParams.get("type");
  let preSelectedFilter: preSelectedFilterType = {};
  if (source) preSelectedFilter.sourceServerName = source;
  if (jobType) preSelectedFilter.jobType = jobType;

  const { selectedProjectId } = useSelectedProjectId();
  const {
    data: jobList,
    isFetching,
    isLoading,
    isError,
  } = useGetJobConfigsQuery({ projectId: selectedProjectId });
  const [updateStatus] = useUpdateJobStatusMutation();

  const rowMenu = (row: any) => [
    {
      label: "Details",
      onClick: () => {
        navigate(`/job-details/${row.jobConfigId}`);
      },
    },
    {
      label:
        row.jobStatus === JOB_CONFIG_STATUS_ENUM.ACTIVE
          ? "Deactivate"
          : "Activate",
      onClick: () => {
        updateStatus({
          id: row.jobConfigId,
          status:
            row.jobStatus === JOB_CONFIG_STATUS_ENUM.ACTIVE
              ? JOB_CONFIG_STATUS_ENUM.INACTIVE
              : JOB_CONFIG_STATUS_ENUM.ACTIVE,
        })
          .then((res) => {
            if (res.error) throw res.error;
            notify.success("Successfully updated the job status.");
          })
          .catch((err) => {
            notify.error(err.message || "Failed to change the status");
          });
      },
      disabled: !canManageJob,
    },
  ];

  const tableStateProps = {
    columns: JOB_LIST_COLUMN_DEFS,
    rows: jobList && getJobListFlaternList(jobList),
    isSorting: true,
    pageSize: 10,
    defaultColumnState,
    defaultSortState: { sortOrder: "desc", column: "createdAt" },
  };

  const refreshJobList = () => {
    // console.log("isFetching - first", isFetching);
    // console.log("isLoading - first", isLoading);
    // dispatch(jobsApi.util.invalidateTags(["ALL_JOB_CONFIGS"]));
    const { recallApiData } = RefreshTableData(dispatch);
    recallApiData({api: jobsApi, tag: 'ALL_JOB_CONFIGS'});
  }

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      isLoading={isLoading}
      rowMenu={rowMenu}
      label="Job Listings"
      content={<></>}
      isTogglingColumns={true}
      originalColumns={JOB_LIST_COLUMN_DEFS}
      showFilters={true}
      columnsToFilter={COLUMNS_TO_FILTER_DEFS}
      preSelectedFilter={preSelectedFilter}
      refreshFunc={refreshJobList}
      isRefreshing={isFetching}
    />
  );
};

export default JobsList;
