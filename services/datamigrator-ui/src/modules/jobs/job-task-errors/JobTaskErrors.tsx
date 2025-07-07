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
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useIsErrorLogsCsvReadyQuery,
  useLazyGenerateErrorLogsQuery,
  useLazyDownloadErrorLogsCSVQuery,
} from "@api/reportApi";
import { createUrl, handleDownloadErrorsLogs } from "@modules/jobs/jobs.utils";
import { ErrorLogActionButton } from "@modules/jobs/job-task-errors/components/ErrorLogActionButton";

const JobTaskErrors = () => {
  const [jobConfigDetails, setJobConfigDetails] =
    useState<JobConfigDetailsApiType>();
  const [currentErrorType, setCurrentErrorType] = useState<string>(
    JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR
  );

  const { jobId, jobRunId } = useParams<{ jobRunId: string; jobId: string }>();

  const queryParams = createUrl({ jobRunId: jobRunId });

  // API hooks
  const { data } = useIsErrorLogsCsvReadyQuery(queryParams, {
    pollingInterval: Number(
      window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
    ),
    skipPollingIfUnfocused: true,
    skip: !jobRunId,
  });
  const [downloadErrorLogs] = useLazyDownloadErrorLogsCSVQuery();
  const [getJobConfigDetailsApi] = useLazyGetJobConfigDetailsQuery();
  const [generateErrorLogs] = useLazyGenerateErrorLogsQuery();

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
      const queryParams = createUrl({ jobRunId: jobRunId });
      await generateErrorLogs(queryParams).unwrap();
    } catch (error) {
      const errorMsg = "Error while downloading error logs.";
      notify.error(error?.data?.message || errorMsg);
      console.error(`errorMsg ${error?.data?.message}`);
    }
  };

  return (
    <Box className="flex flex-col gap-8">
      <Box className="flex flex-row justify-between items-center">
        <JobTaskErrorsBreadcrumbs />

        <ErrorLogActionButton
          data={data}
          handleGenerate={generateErrorReport}
          handleDownload={() =>
            handleDownloadErrorsLogs(downloadErrorLogs, { jobRunId }, "CSV")
          }
        />
      </Box>

      <JobTaskErrorsTabs
        currentErrorType={currentErrorType}
        setCurrentErrorType={setCurrentErrorType}
      />
      <JobTaskDetails jobConfigDetails={jobConfigDetails} />
      <ErrorsListTable currentErrorType={currentErrorType} />
    </Box>
  );
};

export default JobTaskErrors;
