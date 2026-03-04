import {
  JOB_ACTION_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
} from "@/types/app.type";
import {
  useGetJobRunsQuery,
  useUpdateJobRunStatusMutation,
} from "@api/jobsApi";
import {
  useDownloadReportsMutation,
  useGetPdfReportMutation,
} from "@api/reportApi";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  handleDownloadReport,
  handleDownloadCocReport,
} from "@modules/jobs/jobs.utils";
import ActionButtons from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/components/Review/components/ActionButtons";
import { useState } from "react";
import { useLatestJobRun } from "@/hooks/useLatestJobRun";
import { useNavigate } from "react-router-dom";
import {
  COLUMNS_TO_FILTER_DEFS,
  defaultColumnState,
  JOB_RUN_LIST_COLUMN_DEFS,
} from "@modules/jobs/job-run-list/run.constants";
import {
  getActionMenu,
  getJobRunListFlaternList,
  getReportActions,
} from "@modules/jobs/job-run-list/run.utils";
import CutoverConfirmationModal from "@components/modal/CutOverConfirmationModal";
import useAdhocRun from "@hooks/useAdhocRun";
import TitleWithLastRefreshedDate from "@components/TitleWithLastRefreshedDate/TitleWithLastRefreshedDate";

const JobRunList = () => {
  const navigate = useNavigate();
  const adhocRun = useAdhocRun();
  const { selectedProjectId } = useSelectedProjectId();
  const {
    data: jobRunList,
    isLoading,
    isFetching,
    refetch,
  } = useGetJobRunsQuery(
    {
      projectId: selectedProjectId,
    },
    {
      refetchOnMountOrArgChange: true,
      skip: !selectedProjectId,
    }
  );
  const { latestJobRun } = useLatestJobRun(jobRunList);

  const [jobRunListSelectedIds, setJobRunListSelectedIds] = useState<string[]>(
    []
  );
  const [filteredJobRunList, setFilteredJobRunList] = useState<JobRunApiType[]>(
    []
  );

  const [updateStatus, { isLoading: isUpdating }] =
    useUpdateJobRunStatusMutation();
  const [openConfirmation, setOpenConfirmation] = useState(false);
  const [selectedJobRunId, setSelectedJobRunId] = useState("");
  const [downloadReportApi] = useDownloadReportsMutation();
  const [getPdfReportApi] = useGetPdfReportMutation();
  const canDownloadReport = hasPermission(USER_PERMISSION_TYPE_ENUM.Reports);
  const canUpdateStatus = hasPermission(USER_PERMISSION_TYPE_ENUM.ManageJob);
  const handleUpdateStatus = async (
    jobRunId: JobRunApiType["jobRunId"],
    status: JOB_ACTION_STATUS_ENUM
  ) => {
    try {
      await updateStatus({ ids: [jobRunId], status }).unwrap();
      notify.success("Successfully updated the status of Job.");
    } catch (error) {
      notify.error("Failed to update Job Status.");
      console.error(error);
    }
  };
  const rowMenu = (row: JobRunApiType) => {
    const reportMenu = canDownloadReport
      ? getReportActions(
          row,
          handleDownloadReport,
          handleDownloadCocReport,
          downloadReportApi,
          getPdfReportApi
        )
      : [];
    const actionMenu = canUpdateStatus
      ? getActionMenu({
          jobRunId: row.jobRunId,
          status: row.status,
          handleUpdateStatus,
          isDisabled: isLoading || isUpdating,
          adhocRun: () => adhocRun(row.jobConfigId),
        })
      : [];
    const enableCutOver =
      row?.jobType === JOBS_TYPE.CUT_OVER &&
      row?.status === JOB_STATUS_TYPE_ENUM.BLOCKED
        ? [
            {
              label: "Review",
              onClick: () => {
                setOpenConfirmation(true);
                setSelectedJobRunId(row.jobRunId);
              },
            },
          ]
        : [];
    return [
      {
        label: "Details",
        onClick: () => {
          navigate(`/job-details/${row.jobConfigId}/run/${row.jobRunId}`);
        },
      },
      ...reportMenu,
      ...actionMenu,
      ...enableCutOver,
    ];
  };
  const closeConfirmationBox = () => {
    setOpenConfirmation(false);
    setSelectedJobRunId("");
  };
  const tableStateProps = {
    columns: JOB_RUN_LIST_COLUMN_DEFS,
    rows: jobRunList && getJobRunListFlaternList(jobRunList),
    isSorting: true,
    isRowSelecting: true,
    defaultColumnState,
    pageSize: 10,
    defaultSortState: { sortOrder: "desc", column: "startTime" },
  };

  const handleSelections = (
    selectedRowIds: string[],
    _filteredJobRunList: JobRunApiType[]
  ) => {
    setJobRunListSelectedIds(selectedRowIds);
    setFilteredJobRunList(_filteredJobRunList);
  };

  return (
    <>
      {openConfirmation && (
        <CutoverConfirmationModal
          jobRunId={selectedJobRunId}
          closeConfirmationBox={closeConfirmationBox}
        />
      )}
      <TableWrapper
        secondaryLabel={
          <TitleWithLastRefreshedDate date={latestJobRun?.lastRefreshed} />
        }
        tableStateProps={tableStateProps}
        isLoading={isLoading}
        rowMenu={rowMenu}
        label="Job Run List"
        content={
          <ActionButtons
            selectedRowIds={jobRunListSelectedIds}
            showResumeButton={true}
            rows={filteredJobRunList}
          />
        }
        isTogglingColumns={true}
        originalColumns={JOB_RUN_LIST_COLUMN_DEFS}
        showFilters={true}
        columnsToFilter={COLUMNS_TO_FILTER_DEFS}
        handleSelection={handleSelections}
        refetchTableData={refetch}
        isRefreshing={isFetching}
      />
    </>
  );
};

export default JobRunList;
