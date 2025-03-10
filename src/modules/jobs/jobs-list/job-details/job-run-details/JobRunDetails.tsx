import {
  JOB_ACTION_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
} from "@/types/app.type";
import {
  useDownloadReportsMutation,
  useGetJobRunDetailsQuery,
  useGetPdfReportMutation,
} from "@api/reportApi";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import {
  ActionMenu,
  ActionMenuButtonStyle,
  Breadcrumbs,
  Button,
  DropdownButton,
} from "@netapp/bxp-design-system-react";
import { useNavigate, useParams } from "react-router-dom";
import { useUpdateJobRunStatusMutation } from "@api/jobsApi";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import {
  getActionMenu,
  getReportActions,
} from "@modules/jobs/job-run-list/run.utils";
import { handleDownloadReport } from "@modules/jobs/jobs.utils";
import JobDescription from "../components/JobDescription";
import JobErrors from "../components/JobErrors";
import JobRunHeader from "../components/JobRunHeader";
import JobRunTaskCard from "../components/JobRunTaskDetails";
import { getGrafanaLogUrl } from "@/utils/common.utils";
import { useState } from "react";
import CutoverConfirmationModal from "@components/Modal/CutOverConfirmationModal";

const JobRunDetails = () => {
  const navigation = useNavigate();
  const params = useParams<{ jobId: string; jobRunId: string }>();
  const { jobId, jobRunId } = params;
  const { data: jobRunDetails, isLoading } = useGetJobRunDetailsQuery(
    { jobRunId },
    {
      pollingInterval: Number(import.meta.env.VITE_TIME_INTERVAL),
      skipPollingIfUnfocused: true,
    }
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

  const [openConfirmation, setOpenConfirmation] = useState<boolean>(false);

  const canUpdateStatus = hasPermission(USER_PERMISSION_TYPE_ENUM.ManageJob);

  const enableCutOver =
    jobRunDetails?.jobConfig?.jobType === JOBS_TYPE.CUT_OVER &&
    jobRunDetails?.status === JOB_STATUS_TYPE_ENUM.BLOCKED
      ? [
          {
            label: "Review",
            onClick: () => setOpenConfirmation(true),
          },
        ]
      : [];

  const ActionButtons = canUpdateStatus
    ? [
        ...getActionMenu({
          jobRunId,
          status: jobRunDetails?.status || JOB_STATUS_TYPE_ENUM.COMPLETED,
          handleUpdateStatus,
          isDisabled: false,
        }),
        ...enableCutOver,
      ]
    : [];

  const [downloadReportApi] = useDownloadReportsMutation();
  const [getPdfReportApi] = useGetPdfReportMutation();

  const canDownloadReport = hasPermission(
    USER_PERMISSION_TYPE_ENUM.AgentDeployment
  );
  const ReportActionButtons =
    jobRunDetails && canDownloadReport
      ? getReportActions(
          {
            ...jobRunDetails,
            jobType: jobRunDetails.jobConfig.jobType,
            jobRunId,
          },
          handleDownloadReport,
          downloadReportApi,
          getPdfReportApi,
          "button"
        )
      : [];

  const isDiscoveryJob =
    jobRunDetails?.jobConfig?.jobType === JOBS_TYPE.DISCOVERY;

  const viewLogUrl = getGrafanaLogUrl(jobRunId);

  return (
    <Box className="px-4 pt-2 flex flex-col gap-4">
      {openConfirmation && (
        <CutoverConfirmationModal
          jobRunId={jobRunId}
          closeConfirmationBox={() => setOpenConfirmation(false)}
        />
      )}
      <Box className="flex justify-between">
        <Breadcrumbs className="mb-4">
          <Button onClick={() => navigation("/jobs-list")} variant="text">
            Jobs
          </Button>
          <Button
            onClick={() => navigation(`/job-details/${jobId}`)}
            variant="text"
          >
            Job Details
          </Button>
          <Box>Job Run Details</Box>
        </Breadcrumbs>
        <Box className="flex gap-2">
          {ActionButtons.length > 0 && (
            <ActionMenuButtonStyle
              button={<DropdownButton>Action</DropdownButton>}
            >
              {ActionButtons.map((row) => (
                <ActionMenu.Button
                  onClick={row.onClick}
                  isDisabled={isLoading || isUpdating}
                  key={row.label}
                >
                  {row.label}
                </ActionMenu.Button>
              ))}
            </ActionMenuButtonStyle>
          )}
          {ReportActionButtons.length > 0 && (
            <ActionMenuButtonStyle
              isDisabled={!jobRunDetails?.isReportReady}
              button={
                <DropdownButton>
                  {isDiscoveryJob ? "Discovery" : "Download"} Report
                </DropdownButton>
              }
            >
              {isDiscoveryJob && (
                <ActionMenu.Button
                  onClick={() =>
                    void navigation(`/job-discovery-preview/${jobRunId}`)
                  }
                >
                  Preview
                </ActionMenu.Button>
              )}
              {ReportActionButtons.map((row) => (
                <ActionMenu.Button
                  onClick={row.onClick}
                  isDisabled={row.disabled}
                  key={row.label}
                >
                  {row.label}
                </ActionMenu.Button>
              ))}
            </ActionMenuButtonStyle>
          )}
          <Button
            onClick={() => {
              window.open(viewLogUrl, "_blank");
            }}
          >
            View Logs
          </Button>
        </Box>
      </Box>
      <JobRunHeader jobRunDetails={jobRunDetails} />
      <JobRunTaskCard jobRunDetails={jobRunDetails} />
      <Box className="flex gap-6 items-stretch">
        <Box className="grow basis-1/2">
          <JobDescription
            id={jobRunDetails?.id}
            source={jobRunDetails?.jobConfig.sourceServer}
            destination={jobRunDetails?.jobConfig.destinationServer}
          />
        </Box>
        <Box className="grow basis-1/2 items-stretch">
          <JobErrors />
        </Box>
      </Box>
    </Box>
  );
};

export default JobRunDetails;
