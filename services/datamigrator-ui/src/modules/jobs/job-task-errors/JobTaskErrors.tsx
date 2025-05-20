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

const JobTaskErrors = () => {
  const [jobConfigDetails, setJobConfigDetails] =
    useState<JobConfigDetailsApiType>();
  const [getJobConfigDetailsApi] = useLazyGetJobConfigDetailsQuery();
  const { jobId } = useParams<{ jobRunId: string; jobId: string }>();
  const [currentErrorType, setCurrentErrorType] = useState<string>(
    JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR
  );

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

  return (
    <Box className="flex flex-col gap-8">
      <JobTaskErrorsBreadcrumbs />
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
