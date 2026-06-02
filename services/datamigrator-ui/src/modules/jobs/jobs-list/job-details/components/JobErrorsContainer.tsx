import {
  JOB_RUN_ERRORS_TYPE_KEY,
  JobRunErrorsOverviewApiType,
} from "@/types/app.type";
import { useGetJobRunErrorsOverviewQuery } from "@api/jobsApi";
import { CardContent, Notification } from "@netapp/bxp-design-system-react";
import { memo, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";

const JOB_RUN_ERRORS_POLLING_INTERVAL = 5000; // 5 seconds

const JobErrorsContainer = ({
  latestJobRunId,
  preloadedErrorDetails,
  pollJobRunErrors,
  errorDetails,
  setErrorDetails,
}: {
  latestJobRunId?: string;
  preloadedErrorDetails?: JobRunErrorsOverviewApiType[];
  pollJobRunErrors?: boolean;
  errorDetails: JobRunErrorsOverviewApiType[];
  setErrorDetails: (errorDetails: JobRunErrorsOverviewApiType[]) => void;
}) => {
  const { jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const activeJobRunId = latestJobRunId || jobRunId;

  const { data: polledErrorDetails } = useGetJobRunErrorsOverviewQuery(
    { jobRunId: activeJobRunId },
    {
      pollingInterval: JOB_RUN_ERRORS_POLLING_INTERVAL,
      skipPollingIfUnfocused: true,
      refetchOnMountOrArgChange: true,
      skip: !pollJobRunErrors || !activeJobRunId,
    }
  );

  useEffect(() => {
    const errorDetails = preloadedErrorDetails ?? polledErrorDetails;
    if (errorDetails) {
      setErrorDetails(errorDetails);
    }
  }, [preloadedErrorDetails, polledErrorDetails, setErrorDetails]);

  const getErrorCount = useCallback(
    (errorType: JOB_RUN_ERRORS_TYPE_KEY) => {
      const error = errorDetails?.find((err) => err.errortype === errorType);
      return error ? error.count : 0;
    },
    [errorDetails]
  );

  const fatalErrorCount = getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR);
  const transientErrorCount = getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.TRANSIENT_ERROR);

  return (
    <CardContent className="flex flex-col gap-4">
      {fatalErrorCount !== 0 && (
        <Notification type="error">
          Fatal Errors ({fatalErrorCount})
        </Notification>
      )}
      {transientErrorCount !== 0 && (
        <Notification type="warning">
          Transient Errors ({transientErrorCount})
        </Notification>
      )}
    </CardContent>
  );
};

export default memo(JobErrorsContainer);
