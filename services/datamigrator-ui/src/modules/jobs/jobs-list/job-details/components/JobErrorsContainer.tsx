import {
  JOB_RUN_ERRORS_TYPE_KEY,
  JobRunErrorsOverviewApiType,
} from "@/types/app.type";
import { useLazyGetJobRunErrorsOverviewQuery } from "@api/jobsApi";
import { notify } from "@components/notification/NotificationWrapper";
import { CardContent, Notification } from "@netapp/bxp-design-system-react";
import { memo, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";

const JobErrorsContainer = ({
  latestJobRunId,
  errorDetails,
  setErrorDetails,
}: {
  latestJobRunId: string;
  errorDetails: JobRunErrorsOverviewApiType[];
  setErrorDetails: (errorDetails: JobRunErrorsOverviewApiType[]) => void;
}) => {
  const { jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const [getJobRunErrorsOverviewApi] = useLazyGetJobRunErrorsOverviewQuery();

  useEffect(() => {
    if (latestJobRunId || jobRunId) {
      (async () => {
        try {
          const _JobErrorsOverview: JobRunErrorsOverviewApiType[] =
            await getJobRunErrorsOverviewApi({
              jobRunId: latestJobRunId || jobRunId,
            }).unwrap();
          setErrorDetails(_JobErrorsOverview);
        } catch (error) {
          notify.error("Failed to fetch job errors.");
          console.error({ error, level: "Job error card" });
        }
      })();
    }
  }, [latestJobRunId, getJobRunErrorsOverviewApi]);

  const getErrorCount = useCallback(
    (errorType: JOB_RUN_ERRORS_TYPE_KEY) => {
      const error = errorDetails?.find((err) => err.errortype === errorType);
      return error ? error.count : 0;
    },
    [errorDetails]
  );

  const fatalErrorCount = getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR);
  const transientErrorCount = getErrorCount(
    JOB_RUN_ERRORS_TYPE_KEY.TRANSIENT_ERROR
  );

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
