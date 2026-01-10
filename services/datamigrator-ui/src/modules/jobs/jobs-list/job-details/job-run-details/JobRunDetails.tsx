import {
  JOB_ACTION_STATUS_ENUM,
  JOB_STATUS_TYPE_ENUM,
  JobRunApiType,
  JOBS_TYPE,
} from "@/types/app.type";
import { getGrafanaLogUrl } from "@/utils/common.utils";
import {
  useLazyGetJobRunIdentityMappingsQuery,
  useUpdateJobRunStatusMutation,
} from "@api/jobsApi";
import { format } from "date-fns";
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
import { getActionMenu, getReportActions, } from "@modules/jobs/job-run-list/run.utils";
import JobDescription from "@modules/jobs/jobs-list/job-details/components/JobDescription";
import JobRunHeader from "@modules/jobs/jobs-list/job-details/components/JobRunHeader";
import JobRunTaskCard from "@modules/jobs/jobs-list/job-details/components/JobRunTaskDetails";
import { handleDownloadReport, handleDownloadCocReport, } from "@modules/jobs/jobs.utils";
import {
  ActionMenu,
  ActionMenuButtonStyle,
  Breadcrumbs,
  Button,
  DropdownButton, 
  Text, 
} from "@netapp/bxp-design-system-react";
import { useDispatch } from "react-redux";
import { setModalClose, setModalProps } from "@store/reducer/commonComponentSlice";
import { useCallback, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useAdhocRun from "@hooks/useAdhocRun";
import { Show } from "@components/show/Show";
import JobErrors from "@modules/jobs/jobs-list/job-details/components/JobErrors";
import { GENERATING_REPORT_LABEL } from "@modules/jobs/jobs-list/job-details/job-details.constants";
import TitleWithLastRefreshedDate from "@components/TitleWithLastRefreshedDate/TitleWithLastRefreshedDate";
import ExistingIdentityMappings from "@hooks/useExistingIdentityMappings";

const JobRunDetails = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
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

  const [fetchIdentityMappings, { data: jobRunIdentityMappings }] = useLazyGetJobRunIdentityMappingsQuery();
  useEffect(() => {
    if (jobRunId && jobRunDetails?.jobConfig?.jobType === JOBS_TYPE.MIGRATE) {
      fetchIdentityMappings(jobRunId);
    }
  }, [jobRunId, jobRunDetails?.jobConfig?.jobType, fetchIdentityMappings]);

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
  
  const formatSkipFile = (skipFile: string | undefined): string => {
    if (!skipFile) return "-";
    return skipFile
      .split("-")
      .map((part) => {
        if (part.endsWith("M")) return `${part.replace("M", "")} Minutes`;
        if (part.endsWith("H")) return `${part.replace("H", "")} Hours`;
        if (part.endsWith("D")) return `${part.replace("D", "")} Days`;
        return part;
      })
      .join("");
  };

  const isDiscoveryJob = jobRunDetails?.jobConfig?.jobType === JOBS_TYPE.DISCOVERY;
  const isMigrationJob = jobRunDetails?.jobConfig?.jobType === JOBS_TYPE.MIGRATE;
  const viewLogUrl = getGrafanaLogUrl(jobRunId);

  const showJobConfigDetails = () => {
    const jobRunProtocol = jobRunDetails?.jobConfig?.sourceServer?.protocol;
    const jobRunConfig = jobRunDetails?.jobOptions;
    const preserveATime = jobRunConfig?.preserveAccessTime ? "Enabled" : "Disabled";
    const excludeOlderThan = jobRunConfig?.excludeOlderThan ? format(new Date(jobRunConfig.excludeOlderThan), "dd MMM yyyy, hh:mm a") : "-";
    const excludeFilePatterns = jobRunConfig?.excludeFilePatterns?.split(',').join('\n') || "-";
    if (isDiscoveryJob) {
      const shouldScanAds = jobRunConfig?.shouldScanADS ? "Enabled" : "Disabled";
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: "Job Configuration Details",
          modalContent: (
            <Box>
              <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
                <Box className="p-8 flex gap-8">
                  <Box className="w-3/6 flex flex-col gap-8">
                    <Box>
                      <Text className="!mb-0 font-semibold">Excluded Path Patterns:</Text>
                      <Text className="whitespace-pre-wrap">{excludeFilePatterns}</Text>
                    </Box>
                  </Box>
                  <Box className="w-3/6 flex flex-col gap-8">
                    { jobRunProtocol === 'SMB' &&
                      <Box>
                        <Text className="!mb-0 font-semibold">Scan Alternate Data Streams (ADS):</Text>
                        <Text>{shouldScanAds}</Text>
                      </Box>
                    }
                  </Box>
                </Box>
              </Box> 
              <Box className="pt-3 flex justify-end mt-3">
                <Button color="secondary" onClick={() => dispatch(setModalClose())}>
                  Close
                </Button>
              </Box>
            </Box>
          ),
          modalFooter: null,
        })
      );
    }
    else if (isMigrationJob) {
      const skipFilesModified = formatSkipFile(jobRunConfig?.skipFile);
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: "Job Configuration Details",
          modalContent: (
            <Box>
              <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
                <Box className="p-8 flex gap-8">
                  <Box className="w-3/6 flex flex-col gap-8">
                    <Box>
                      <Text className="!mb-0 font-semibold">Preserve a-time:</Text>
                      <Text>{preserveATime}</Text>
                    </Box>
                    <Box>
                      <Text className="!mb-0 font-semibold">Exclude files older than:</Text>
                      <Text>{excludeOlderThan}</Text>
                    </Box>
                    <Box>
                      <Text className="!mb-0 font-semibold">Skip files modified in last:</Text>
                      <Text>{skipFilesModified}</Text>
                    </Box>
                  </Box>  
                  <Box className="w-3/6 flex flex-col gap-8">
                    <Box>
                      <Text className="!mb-0 font-semibold">Excluded Path Patterns:</Text>
                      <Text className="whitespace-pre-wrap">{excludeFilePatterns}</Text>
                    </Box>
                    { jobRunConfig?.identityMappingId &&
                    <ExistingIdentityMappings
                      existingMappings={{
                        items: {
                          data: jobRunIdentityMappings?.items?.data
                        }
                      }}
                      protocol={jobRunProtocol}
                      jobId={jobId}
                      jobRunId={jobRunId}
                    />
                    }
                  </Box>
                </Box>
              </Box> 
              <Box className="pt-3 flex justify-end mt-3">
                <Button color="secondary" onClick={() => dispatch(setModalClose())}>
                  Close
                </Button>
              </Box>
            </Box>
          ),
          modalFooter: null,
        })
      );
    }
    else { //Cutover job
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: "Job Configuration Details",
          modalContent: (
            <Box>
              <Box className="!bg-white mx-auto shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px]">
                <Box className="p-8 flex gap-8">
                  <Box className="w-3/6 flex flex-col gap-8">
                    <Box>
                      <Text className="!mb-0 font-semibold">Preserve a-time:</Text>
                      <Text>{preserveATime}</Text>
                    </Box>
                    <Box>
                      <Text className="!mb-0 font-semibold">Exclude files older than:</Text>
                      <Text>{excludeOlderThan}</Text>
                    </Box>
                  </Box>  
                  <Box className="w-3/6 flex flex-col gap-8">
                    <Box>
                      <Text className="!mb-0 font-semibold">Excluded Path Patterns:</Text>
                      <Text className="whitespace-pre-wrap">{excludeFilePatterns}</Text>
                    </Box>
                  </Box>
                </Box>
              </Box> 
              <Box className="pt-3 flex justify-end mt-3">
                <Button onClick={() => dispatch(setModalClose())} color="secondary">
                  Close
                </Button>
              </Box>
            </Box>
          ),
          modalFooter: null,
        })
      );
    }
  }

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

      <Box className="flex justify-between">
        <TitleWithLastRefreshedDate date={jobRunDetails?.lastRefreshed} />
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
          <Button
            onClick={() => {
              showJobConfigDetails()
            }}
          >
            View Configuration
          </Button>
        </Box>
      </Box>
      <JobRunHeader jobRunDetails={jobRunDetails} />
      <JobRunTaskCard jobRunDetails={jobRunDetails} jobRunId={jobRunId} />
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