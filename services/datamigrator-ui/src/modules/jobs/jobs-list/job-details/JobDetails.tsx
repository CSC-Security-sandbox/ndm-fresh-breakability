import PermissionAuth from "@/auth/PermissionAuth";
import {
  JOB_ACTION_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobConfigDetailsApiType,
  JobRunApiType,
  JOBS_TYPE,
} from "@/types/app.type";
import {
  useGetJobConfigDetailsQuery,
  useUpdateJobRunStatusMutation,
} from "@api/jobsApi";
import {
  useDownloadReportsMutation,
  useGetPdfReportMutation,
  useIsErrorLogsCsvReadyQuery,
  useLazyDownloadErrorLogsCSVQuery,
  useLazyGenerateErrorLogsQuery,
} from "@api/reportApi";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import CutoverConfirmationModal from "@components/modal/CutOverConfirmationModal";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import TitleWithLastRefreshedDate from "@components/TitleWithLastRefreshedDate/TitleWithLastRefreshedDate";
import useAdhocRun from "@hooks/useAdhocRun";
import {
  getActionMenu,
  getReportActions,
} from "@modules/jobs/job-run-list/run.utils";
import { ErrorLogActionButton } from "@modules/jobs/job-task-errors/components/ErrorLogActionButton";
import {
  DOWNLOAD_BULK_ERROR_REPORT,
  GENERATE_BULK_ERROR_REPORT,
} from "@modules/jobs/job-task-errors/jobTaskErrors.constant";
import JobDescription from "@modules/jobs/jobs-list/job-details/components/JobDescription";
import JobErrors from "@modules/jobs/jobs-list/job-details/components/JobErrors";
import JobHeader from "@modules/jobs/jobs-list/job-details/components/JobHeader";
import { JOB_RUN_LIST_COLUMN_DEFS } from "@modules/jobs/jobs-list/job-details/job-details.constants";
import {
  handleDownloadCocReport,
  handleDownloadErrorsLogs,
  handleDownloadReport,
} from "@modules/jobs/jobs.utils";
import { Breadcrumbs, Button, Heading } from "@netapp/bxp-design-system-react";
import { useEffect, useMemo, useState } from "react";
import { useLatestJobRun } from "@/hooks/useLatestJobRun";
import { useNavigate, useParams } from "react-router-dom";

const JobDetails = () => {
  const LOWER_TIME_INTERVAL_FOR_IN_PROGRESS = 5000; // 5 seconds
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const adhocRun = useAdhocRun();

  const [openConfirmation, setOpenConfirmation] = useState(false);
  const [selectedJobRunId, setSelectedJobRunId] = useState("");
  const [isFrequentInterval, setIsFrequentInterval] = useState<boolean>(false);

  const [showGeneratingReportBtn, setShowGeneratingReportBtn] =
    useState<Record<string, boolean>>();
  const {
    data: jobConfigDetails,
    isLoading,
    refetch,
    isFetching,
  } = useGetJobConfigDetailsQuery(
    { jobConfigId: jobId },
    {
      pollingInterval: isFrequentInterval
        ? LOWER_TIME_INTERVAL_FOR_IN_PROGRESS
        : Number(
            window?.env?.VITE_TIME_INTERVAL ||
              import.meta.env.VITE_TIME_INTERVAL
          ),
      skipPollingIfUnfocused: true,
    }
  );
  const [downloadErrorLogs] = useLazyDownloadErrorLogsCSVQuery();
  const [generateErrorLogs] = useLazyGenerateErrorLogsQuery();
  const { data } = useIsErrorLogsCsvReadyQuery(
    { type: "job-config", id: jobId },
    {
      pollingInterval: Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ),
      skipPollingIfUnfocused: true,
      skip: !jobId,
    }
  );

  useEffect(() => {
    if (jobConfigDetails?.jobRuns?.length === 0) {
      setIsFrequentInterval(true);
    } else {
      setIsFrequentInterval(false);
    }
  }, [jobConfigDetails?.jobRuns?.length]);

  const [downloadReportApi] = useDownloadReportsMutation();
  const [getPdfReportApi] = useGetPdfReportMutation();

  const canDownloadReport = hasPermission(USER_PERMISSION_TYPE_ENUM.Reports);

  const [updateStatus, { isLoading: isUpdating }] =
    useUpdateJobRunStatusMutation();

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

  const canUpdateStatus = hasPermission(USER_PERMISSION_TYPE_ENUM.ManageJob);

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
          adhocRun: () => adhocRun(jobId),
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
          navigate(`/job-details/${jobId}/run/${row.jobRunId}`);
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

  const defaultColumnState = { scannedDirectoriesCount: { isHidden: true } };

  const tableStateProps = {
    columns: JOB_RUN_LIST_COLUMN_DEFS,
    rows: jobConfigDetails?.jobRuns,
    isSorting: true,
    pageSize: 10,
    defaultColumnState,
    defaultSortState: { sortOrder: "desc", column: "startTime" },
  };

  const errorsCount = useMemo(() => {
    if (!jobConfigDetails?.jobRuns) return [];
    return jobConfigDetails.jobRuns.flatMap((run) =>
      run.errors ? run.errors.map((error) => error.count || 0) : []
    );
  }, [jobConfigDetails]);

  const { latestJobRun, latestJobRunId } = useLatestJobRun(
    jobConfigDetails?.jobRuns
  );

  useEffect(() => {
    if (data?.ready || data?.processing) {
      setShowGeneratingReportBtn({});
    }
  }, [data]);

  const generateErrorReport = async () => {
    try {
      await generateErrorLogs({ type: "job-config", id: jobId }).unwrap();
      setShowGeneratingReportBtn({
        ready: false,
        processing: true,
      });
      notify.success("Error Report generation started successfully.");
    } catch (error) {
      const errorMsg = "Error while downloading error logs.";
      notify.error(error?.data?.displayMessage || errorMsg);
      console.error(`errorMsg ${error?.data?.message}`);
    }
  };

  const isDisplayGeneratingLabel = useMemo(() => {
    const hasReportData =
      showGeneratingReportBtn && Object.keys(showGeneratingReportBtn).length;

    return hasReportData ? showGeneratingReportBtn : data;
  }, [showGeneratingReportBtn]);

  const errorLogContent = useMemo(() => {
    return (
      <ErrorLogActionButton
        generateLabel={GENERATE_BULK_ERROR_REPORT}
        downloadLabel={DOWNLOAD_BULK_ERROR_REPORT}
        data={isDisplayGeneratingLabel}
        disabled={errorsCount.length === 0}
        handleGenerate={generateErrorReport}
        handleDownload={() =>
          handleDownloadErrorsLogs(
            downloadErrorLogs,
            { type: "job-config", id: jobId },
            "CSV"
          )
        }
      />
    );
  }, [jobId, downloadErrorLogs, generateErrorReport]);

  return (
    <Box className="flex flex-col gap-4">
      {openConfirmation && (
        <CutoverConfirmationModal
          jobRunId={selectedJobRunId}
          closeConfirmationBox={closeConfirmationBox}
        />
      )}
      <Breadcrumbs className="mb-4" key={jobId}>
        <Button onClick={() => navigate("/jobs-list")} variant="text">
          Jobs
        </Button>
        <Box>Job Details</Box>
      </Breadcrumbs>
      <Box className="flex flex-col gap-2">
        <Box className="flex justify-between">
          <TitleWithLastRefreshedDate
            title={
              <Heading level="16" bold className="flex">
                {jobConfigDetails?.jobType === JOBS_TYPE.DISCOVERY
                  ? "Summary of Last Run"
                  : "Total of All Runs"}
              </Heading>
            }
            date={latestJobRun?.lastRefreshed}
          />

          <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageJob}>
            <Button
              onClick={() => adhocRun(jobId, true)}
              disabled={
                !jobId ||
                jobConfigDetails?.status === JOB_CONFIG_STATUS_ENUM.INACTIVE
              }
            >
              Adhoc Run
            </Button>
          </PermissionAuth>
        </Box>
        <JobHeader jobConfigDetails={jobConfigDetails} />
      </Box>
      <Box className="flex gap-6 items-stretch">
        <Box className="grow basis-1/2">
          <JobDescription
            id={jobId}
            source={jobConfigDetails?.sourceServer}
            destination={jobConfigDetails?.destinationServer}
          />
        </Box>
        <Box className="grow basis-1/2 items-stretch">
          <JobErrors latestJobRunId={latestJobRunId} />
        </Box>
      </Box>
      <TableWrapper
        tableStateProps={tableStateProps}
        isLoading={isLoading}
        rowMenu={rowMenu}
        label="Run History"
        content={errorLogContent}
        isTogglingColumns={true}
        originalColumns={JOB_RUN_LIST_COLUMN_DEFS}
        refetchTableData={refetch}
        isRefreshing={isFetching}
      />
    </Box>
  );
};

export default JobDetails;
