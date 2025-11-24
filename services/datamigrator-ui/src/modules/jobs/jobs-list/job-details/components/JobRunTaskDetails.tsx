import { Card } from "@netapp/bxp-design-system-react";
import Divider from "@mui/material/Divider";
import {
  TASK_STATUS_TYPE_ENUM,
  JobRunTaskCardPropType,
} from "@/types/app.type";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import TaskInfoCard from "@modules/jobs/jobs-list/job-details/components/TaskInfoCard";

const JobRunTaskCard = ({ jobRunDetails, jobRunId }: JobRunTaskCardPropType) => {
  const completed = jobRunDetails?.task.completed || 0;
  const pending = jobRunDetails?.task.pending || 0;
  const errored = jobRunDetails?.task.errored || 0;
  const running = jobRunDetails?.task.running || 0;

  const total = completed + pending + errored + running;
  const url = `/job-details/${jobRunDetails?.jobConfig.id}/run/${jobRunId}/tasks`;
  const workersUrl = `/workers/${jobRunId}`;

  const generateUrl = (status: TASK_STATUS_TYPE_ENUM, count: number) => {
    return `${url}?status=${status}&count=${count}`;
  };

  return (
    <Card className="flex gap-16 p-10">
      <TaskInfoCard
        label="Workers"
        value={jobRunDetails?.worker || 0}
        url={workersUrl}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard label="Tasks" value={total} url={url} />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.PENDING} />
        }
        value={pending}
        url={generateUrl(TASK_STATUS_TYPE_ENUM.PENDING, pending)}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.RUNNING} />
        }
        value={running}
        url={generateUrl(TASK_STATUS_TYPE_ENUM.RUNNING, running)}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.COMPLETED} />
        }
        value={completed}
        url={generateUrl(TASK_STATUS_TYPE_ENUM.COMPLETED, completed)}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.ERRORED} />
        }
        value={errored}
        url={generateUrl(TASK_STATUS_TYPE_ENUM.ERRORED, errored)}
      />
    </Card>
  );
};

export default JobRunTaskCard;
