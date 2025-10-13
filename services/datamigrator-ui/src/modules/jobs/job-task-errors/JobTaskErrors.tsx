import {
  JOB_RUN_ERRORS_TYPE_KEY,
  JobConfigDetailsApiType,
} from "@/types/app.type";
import { useLazyGetJobConfigDetailsQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import ErrorsListTable from "@modules/jobs/job-task-errors/components/ErrorsListTable";
import JobTaskDetails from "@modules/jobs/job-task-errors/components/JobTaskDetails";
import JobTaskErrorsBreadcrumbs from "@modules/jobs/job-task-errors/components/JobTaskErrorsBreadcrumbs";
import JobTaskErrorsTabs from "@modules/jobs/job-task-errors/components/JobTaskErrorsTabs";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useIsErrorLogsCsvReadyQuery,
  useLazyGenerateErrorLogsQuery,
  useLazyDownloadErrorLogsCSVQuery,
} from "@api/reportApi";
import { handleDownloadErrorsLogs } from "@modules/jobs/jobs.utils";
import { ErrorLogActionButton } from "@modules/jobs/job-task-errors/components/ErrorLogActionButton";
import {
  DOWNLOAD_ERROR_REPORT,
  GENERATE_ERROR_REPORT,
} from "@modules/jobs/job-task-errors/jobTaskErrors.constant";

const JobTaskErrors = () => {
  const [jobConfigDetails, setJobConfigDetails] =
    useState<JobConfigDetailsApiType>();
  const [currentErrorType, setCurrentErrorType] = useState<string>(
    JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR
  );

  const { jobId, jobRunId } = useParams<{ jobRunId: string; jobId: string }>();

  const [showGeneratingReportBtn, setShowGeneratingReportBtn] =
    useState<Record<string, boolean>>();

  // API hooks
  const { data } = useIsErrorLogsCsvReadyQuery(
    { type: "job-run", id: jobRunId },
    {
      pollingInterval: Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ),
      skipPollingIfUnfocused: true,
      skip: !jobRunId,
    }
  );
  const [downloadErrorLogs] = useLazyDownloadErrorLogsCSVQuery();
  const [getJobConfigDetailsApi] = useLazyGetJobConfigDetailsQuery();
  const [generateErrorLogs] = useLazyGenerateErrorLogsQuery();

  useEffect(() => {
    if (data?.ready || data?.processing) {
      setShowGeneratingReportBtn({});
    }
  }, [data]);

  useEffect(() => {
    (async () => {
      try {
        const _jobConfigDetails: JobConfigDetailsApiType =
          await getJobConfigDetailsApi({
            jobConfigId: jobId,
          }).unwrap();

        setJobConfigDetails(_jobConfigDetails);
      } catch {
        notify.error("Something went wrong.");
      }
    })();
  }, [jobId]);

  const generateErrorReport = async () => {
    try {
      await generateErrorLogs({ type: "job-run", id: jobRunId }).unwrap();
      setShowGeneratingReportBtn({
        ready: false,
        processing: true,
      });
      notify.success("Error Report generation started successfully.");
    } catch (error) {
      const errorMsg = "Error while downloading error logs.";
      notify.error(error?.data?.message || errorMsg);
      console.error(`errorMsg ${error?.data?.message}`);
    }
  };

  const isDisplayGeneratingLabel = useMemo(() => {
    const hasReportData =
      showGeneratingReportBtn && Object.keys(showGeneratingReportBtn).length;

    return hasReportData ? showGeneratingReportBtn : data;
  }, [showGeneratingReportBtn]);

  return (
    <Box className="flex flex-col gap-8">
      <Box className="flex flex-row justify-between items-center">
        <JobTaskErrorsBreadcrumbs />

        <ErrorLogActionButton
          generateLabel={GENERATE_ERROR_REPORT}
          downloadLabel={DOWNLOAD_ERROR_REPORT}
          data={isDisplayGeneratingLabel}
          handleGenerate={generateErrorReport}
          handleDownload={() =>
            handleDownloadErrorsLogs(
              downloadErrorLogs,
              { type: "job-run", id: jobRunId },
              "CSV"
            )
          }
        />
      </Box>

      <JobTaskErrorsTabs
        currentErrorType={currentErrorType}
        setCurrentErrorType={setCurrentErrorType}
      />
      <JobTaskDetails jobConfigDetails={jobConfigDetails} />
      <ErrorsListTable
        key={currentErrorType}
        currentErrorType={currentErrorType}
      />
    </Box>
  );
};

export default JobTaskErrors;
