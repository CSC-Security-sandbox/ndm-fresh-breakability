import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Text,
} from "@netapp/bxp-design-system-react";
import {
  NoticeTriangleIcon,
  SuccessIcon,
} from "@netapp/bxp-style/react-icons/Notification";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import JobErrorsContainer from "@modules/jobs/jobs-list/job-details/components/JobErrorsContainer";
import { JobRunErrorsOverviewApiType } from "@/types/app.type";

type JobErrorsProps = {
  latestJobRunId?: string;
  preloadedErrorDetails?: JobRunErrorsOverviewApiType[];
  pollJobRunErrors?: boolean;
};

const JobErrors = ({
  latestJobRunId,
  preloadedErrorDetails,
  pollJobRunErrors,
}: JobErrorsProps) => {
  const navigate = useNavigate();
  const [errorDetails, setErrorDetails] = useState<
    JobRunErrorsOverviewApiType[]
  >(preloadedErrorDetails ?? []);

  const handlerErrorNavigation = useCallback(() => {
    if (latestJobRunId) {
      // FOR JOB DETAILS SCREEN
      navigate(`${latestJobRunId}/errors`);
    } else {
      // FOR JOB RUN DETAILS SCREEN
      navigate(`errors`);
    }
  }, [latestJobRunId, navigate]);

  const totalErrorsCount = useMemo(
    () =>
      errorDetails.reduce(
        (totalErrors, error) => totalErrors + Number(error.count),
        0
      ),
    [errorDetails]
  );

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-4">
          {errorDetails?.length > 0 ? (
            <NoticeTriangleIcon color="error" />
          ) : (
            <SuccessIcon color="success" />
          )}
          <Text bold>{latestJobRunId ? "Latest Errors" : "Errors"} ({totalErrorsCount})</Text>
        </CardTitle>
        <Button
          onClick={handlerErrorNavigation}
          color="secondary"
          style={{ margin: "0 0 0 auto" }}
          disabled={errorDetails?.length === 0}
        >
          View All
        </Button>
      </CardHeader>
      <JobErrorsContainer
        latestJobRunId={latestJobRunId}
        preloadedErrorDetails={preloadedErrorDetails}
        pollJobRunErrors={pollJobRunErrors}
        errorDetails={errorDetails}
        setErrorDetails={setErrorDetails}
      />
    </Card>
  );
};

export default JobErrors;
