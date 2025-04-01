import {
  JOB_RUN_ERRORS_TYPE_KEY,
  JobRunErrorsOverviewApiType,
} from "@/types/app.type";
import { useLazyGetJobRunErrorsOverviewQuery } from "@api/jobsApi";
import { notify } from "@components/notification/NotificationWrapper";
import { JobTaskErrorsTabsPropsType } from "@modules/jobs/job-task-errors/JobTaskErrorsTabs.interface";
import { InnerTab } from "@netapp/bxp-design-system-react";
import { memo, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Show } from "@components/show/Show";

const JobTaskErrorsTabs = ({
  currentErrorType,
  setCurrentErrorType,
}: JobTaskErrorsTabsPropsType) => {
  const { jobRunId } = useParams<{ jobRunId: string; jobId: string }>();
  const [errorList, setErrorList] = useState<JobRunErrorsOverviewApiType[]>([]);
  const [getJobRunErrorsOverviewApi] = useLazyGetJobRunErrorsOverviewQuery();

  useEffect(() => {
    (async () => {
      try {
        const _JobErrorsOverview: JobRunErrorsOverviewApiType[] =
          await getJobRunErrorsOverviewApi({
            jobRunId,
          }).unwrap();
        setErrorList(_JobErrorsOverview);
      } catch {
        notify.error("Something went wrong");
      }
    })();
  }, [jobRunId]);

  const getErrorCount = useCallback(
    (errorType: string) => {
      const error = errorList?.find((err) => err.errortype === errorType);
      return error ? error.count : 0;
    },
    [errorList]
  );

  return (
    <InnerTab>
      <Show>
        {/* FATAL ERROR */}
        <Show.When isTrue={getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR) > 0}>
          <InnerTab.Button
            isActive={currentErrorType === JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR}
            onClick={() => setCurrentErrorType(JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR)}
          >
            Fatal Errors ({getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.FATAL_ERROR)})
          </InnerTab.Button>
        </Show.When>

        {/* TRANSIENT ERROR */}
        <Show.When isTrue={getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.TRANSIENT_ERROR) > 0}>
          <InnerTab.Button
            isActive={currentErrorType === JOB_RUN_ERRORS_TYPE_KEY.TRANSIENT_ERROR}
            onClick={() =>
              setCurrentErrorType(JOB_RUN_ERRORS_TYPE_KEY.TRANSIENT_ERROR)
            }
          >
            Transient Errors (
            {getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.TRANSIENT_ERROR)})
          </InnerTab.Button>
        </Show.When>

        {/* RECOVERABLE ERRORS */}
        <Show.When isTrue={getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.RECOVERABLE_ERROR) > 0}>
          <InnerTab.Button
            isActive={currentErrorType === JOB_RUN_ERRORS_TYPE_KEY.RECOVERABLE_ERROR}
            onClick={() =>
              setCurrentErrorType(JOB_RUN_ERRORS_TYPE_KEY.RECOVERABLE_ERROR)
            }
          >
            Recoverable Errors (
            {getErrorCount(JOB_RUN_ERRORS_TYPE_KEY.RECOVERABLE_ERROR)})
          </InnerTab.Button>
        </Show.When>
      </Show>
    </InnerTab>
  );
};

export default memo(JobTaskErrorsTabs);
