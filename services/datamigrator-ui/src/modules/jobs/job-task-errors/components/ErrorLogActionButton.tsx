import { Button } from "@netapp/bxp-design-system-react";
import { Show } from "@components/show/Show";
import { ErrorLogActionButtonPropsType } from "@modules/jobs/job-task-errors/JobTaskErrorsTabs.interface";
import ReportsGeneratingLoader from "@components/ReportsGeneratingLoader/ReportsGeneratingLoader";
import { GENERATING_ERRORS_LOGS_LABEL } from "@modules/jobs/job-task-errors/jobTaskErrors.constant";

export const ErrorLogActionButton = ({
  data,
  handleGenerate,
  handleDownload,
  disabled = false,
  generateLabel,
  downloadLabel,
}: ErrorLogActionButtonPropsType) => {
  return (
    <Show>
      <Show.When isTrue={!data?.processing && !data?.ready}>
        <Button disabled={disabled} onClick={handleGenerate}>
          {generateLabel}
        </Button>
      </Show.When>
      <Show.Else>
        <Show.When isTrue={data?.processing && !data?.ready}>
          <ReportsGeneratingLoader label={GENERATING_ERRORS_LOGS_LABEL} />
        </Show.When>
        <Show.When isTrue={!data?.processing && data?.ready}>
          <Button disabled={disabled} onClick={handleDownload}>
            {downloadLabel}
          </Button>
        </Show.When>
      </Show.Else>
    </Show>
  );
};
