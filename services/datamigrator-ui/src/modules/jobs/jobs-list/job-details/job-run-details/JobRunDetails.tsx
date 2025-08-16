import {
  JOB_ACTION_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
} from "@/types/app.type";
import { getGrafanaLogUrl } from "@/utils/common.utils";
import { useUpdateJobRunStatusMutation } from "@api/jobsApi";
import {
  useDownloadReportsMutation,
  useGetJobRunDetailsQuery,
  useGetPdfReportMutation,
} from "@api/reportApi";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import CutoverConfirmationModal from "@components/modal/CutOverConfirmationModal";
import { notify } from "@components/notification/NotificationWrapper";
import ReportsGeneratingLoader from "@components/ReportsGeneratingLoader/ReportsGeneratingLoader";
import {
  getActionMenu,
  getReportActions,
} from "@modules/jobs/job-run-list/run.utils";
import JobDescription from "@modules/jobs/jobs-list/job-details/components/JobDescription";
import JobRunHeader from "@modules/jobs/jobs-list/job-details/components/JobRunHeader";
import JobRunTaskCard from "@modules/jobs/jobs-list/job-details/components/JobRunTaskDetails";
import {
  handleDownloadReport,
  handleDownloadCocReport,
} from "@modules/jobs/jobs.utils";
import {
  ActionMenu,
  ActionMenuButtonStyle,
  Breadcrumbs,
  Button,
  DropdownButton,
} from "@netapp/bxp-design-system-react";
import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useAdhocRun from "@hooks/useAdhocRun";
import { Show } from "@components/show/Show";
import JobErrors from "@modules/jobs/jobs-list/job-details/components/JobErrors";
import { GENERATING_REPORT_LABEL } from "@modules/jobs/jobs-list/job-details/job-details.constants";

const JobRunDetails = () => {
  const navigate = useNavigate();
  const adhocRun = useAdhocRun();
  const params = useParams<{ jobId: string; jobRunId: string }>();
  const { jobId, jobRunId } = params;
  const { data: jobRunDetails, isLoading } = useGetJobRunDetailsQuery(
    { jobRunId },
    {
      pollingInterval: Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ),
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

  const actionButtons = canUpdateStatus
    ? [
        ...getActionMenu({
          jobRunId,
          status: jobRunDetails?.status || JOB_STATUS_TYPE_ENUM.COMPLETED,
          handleUpdateStatus,
          isDisabled: false,
          adhocRun: () => adhocRun(jobId),
        }),
        ...enableCutOver,
      ]
    : [];

  const [downloadReportApi] = useDownloadReportsMutation();
  const [getPdfReportApi] = useGetPdfReportMutation();

  const canDownloadReport = hasPermission(USER_PERMISSION_TYPE_ENUM.Reports);
  const reportActionButtons =
    jobRunDetails && canDownloadReport
      ? getReportActions(
          {
            ...jobRunDetails,
            jobType: jobRunDetails.jobConfig.jobType,
            jobRunId,
          },
          handleDownloadReport,
          handleDownloadCocReport,
          downloadReportApi,
          getPdfReportApi,
          "button"
        )
      : [];

  const isDiscoveryJob =
    jobRunDetails?.jobConfig?.jobType === JOBS_TYPE.DISCOVERY;

  const viewLogUrl = getGrafanaLogUrl(jobRunId);

  const isJobStatusValid = useCallback(
    (status: JOB_STATUS_TYPE_ENUM) => {
      const validStatuses = [
        JOB_STATUS_TYPE_ENUM.COMPLETED,
        JOB_STATUS_TYPE_ENUM.BLOCKED,
        JOB_STATUS_TYPE_ENUM.APPROVED,
        JOB_STATUS_TYPE_ENUM.REJECTED,
      ];

      return validStatuses.includes(status);
    },
    [jobRunDetails?.status]
  );

  return (
    <Box className="flex flex-col gap-4">
      {openConfirmation && (
        <CutoverConfirmationModal
          jobRunId={jobRunId}
          closeConfirmationBox={() => setOpenConfirmation(false)}
        />
      )}
      <Box className="flex justify-between">
        <Breadcrumbs className="mb-4">
          <Button onClick={() => navigate("/jobs-list")} variant="text">
            Jobs
          </Button>
          <Button
            onClick={() => navigate(`/job-details/${jobId}`)}
            variant="text"
          >
            Job Details
          </Button>
          <Box>Job Run Details</Box>
        </Breadcrumbs>
        <Box className="flex gap-2 items-center">
          {actionButtons.length > 0 && (
            <ActionMenuButtonStyle
              button={<DropdownButton>Action</DropdownButton>}
            >
              {actionButtons.map((row) => (
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
          <Show>
            <Show.When isTrue={reportActionButtons.length > 0}>
              <Show.When
                isTrue={
                  !jobRunDetails?.isReportReady &&
                  isJobStatusValid(jobRunDetails?.status)
                }
              >
                <ReportsGeneratingLoader label={GENERATING_REPORT_LABEL} />
              </Show.When>

              <Show.When
                isTrue={
                  jobRunDetails?.isReportReady &&
                  isJobStatusValid(jobRunDetails?.status)
                }
              >
                <ActionMenuButtonStyle
                  button={
                    <DropdownButton>
                      {isDiscoveryJob ? "Discovery" : "Download"} Report
                    </DropdownButton>
                  }
                >
                  <Show.When isTrue={isDiscoveryJob}>
                    <ActionMenu.Button
                      onClick={() => {
                        navigate(`/job-discovery-preview/${jobRunId}`);
                      }}
                    >
                      Preview
                    </ActionMenu.Button>
                  </Show.When>
                  {reportActionButtons.map((row) => (
                    <ActionMenu.Button
                      onClick={row.onClick}
                      isDisabled={row.disabled}
                      key={row.label}
                    >
                      {row.label}
                    </ActionMenu.Button>
                  ))}
                </ActionMenuButtonStyle>
              </Show.When>
            </Show.When>
          </Show>
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
