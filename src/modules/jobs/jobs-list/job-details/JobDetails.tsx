import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { hasPermission } from "@auth/auth.utils";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import {
  useJobAdhocRunMutation,
  useGetJobConfigDetailsQuery,
  useUpdateJobRunStatusMutation,
} from "@api/jobsApi";
import {
  useDownloadReportsMutation,
  useGetPdfReportMutation,
} from "@api/reportApi";
import {
  JOB_ACTION_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
} from "@/types/app.type";
import { Breadcrumbs, Button, Heading } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import JobDescription from "./components/JobDescription";
import JobErrors from "./components/JobErrors";
import JobHeader from "./components/JobHeader";
import { JOB_RUN_LIST_COLUMN_DEFS } from "./job-details.constants";
import { useParams } from "react-router-dom";
import { handleDownloadReport } from "../../jobs.utils";
import { getActionMenu, getReportActions } from "../../job-run-list/run.utils";
import { useMemo, useState } from "react";
import CutoverConfirmationModal from "@components/Modal/CutOverConfirmationModal";

const JobDetails = () => {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const [openConfirmation, setOpenConfirmation] = useState(false);
  const [selectedJobRunId, setSelectedJobRunId] = useState("");

  const { data: jobConfigDetails, isLoading } = useGetJobConfigDetailsQuery(
    { jobConfigId: jobId },
    {
      pollingInterval: Number(import.meta.env.VITE_TIME_INTERVAL),
      skipPollingIfUnfocused: true,
    }
  );

  const [downloadReportApi] = useDownloadReportsMutation();
  const [getPdfReportApi] = useGetPdfReportMutation();
  const [adhocRun] = useJobAdhocRunMutation();

  const canDownloadReport = hasPermission(
    USER_PERMISSION_TYPE_ENUM.AgentDeployment
  );

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

  const jobAdhocRun = () => {
    adhocRun({ jobConfigId: jobId })
      .then((res) => {
        if (res.error) throw res.error;
        notify.success("Successfully initiated ad-hoc run");
      })
      .catch((err) => {
        notify.error(err.message || "Fail to initiate ad-hoc run");
      });
  };

  const latestJobRunId = useMemo(() => {
    return jobConfigDetails?.jobRuns?.[0]?.jobRunId;
  }, [jobConfigDetails?.jobRuns]);

  return (
    <Box className="flex flex-col gap-4">
      {openConfirmation && (
        <CutoverConfirmationModal
          jobRunId={selectedJobRunId}
          closeConfirmationBox={closeConfirmationBox}
        />
      )}
      <Breadcrumbs className="mb-4">
        <Button onClick={() => navigate("/jobs-list")} variant="text">
          Jobs
        </Button>
        <Box>Job Details</Box>
      </Breadcrumbs>
      <Box className="flex flex-col gap-2">
        <Box className="flex justify-between">
          <Heading level="16" bold>
            {jobConfigDetails?.jobType === JOBS_TYPE.DISCOVERY
              ? "Summary of Last Run"
              : "Total of All Runs"}
          </Heading>
          <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageJob}>
            <Button
              onClick={jobAdhocRun}
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
        content={<></>}
        isTogglingColumns={true}
        originalColumns={JOB_RUN_LIST_COLUMN_DEFS}
      />
    </Box>
  );
};

export default JobDetails;
