import { Card } from "@netapp/bxp-design-system-react";

import Divider from "@mui/material/Divider";
import {
  TASK_STATUS_TYPE_ENUM,
  JobRunTaskCardPropType,
} from "@/types/app.type";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import TaskInfoCard from "./TaskInfoCard";

const JobRunTaskCard = ({ jobRunDetails }: JobRunTaskCardPropType) => {
  const completed = jobRunDetails?.task.completed || 0;
  const pending = jobRunDetails?.task.pending || 0;
  const errored = jobRunDetails?.task.errored || 0;
  const running = jobRunDetails?.task.running || 0;

  const total = completed + pending + errored + running;
  const url = `/job-details/${jobRunDetails?.jobConfig.id}/run/${jobRunDetails?.id}/tasks`;
  const workersUrl = `/job-details/${jobRunDetails?.jobConfig.id}/run/${jobRunDetails?.id}/workers`;

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
        url={`${url}?status=${TASK_STATUS_TYPE_ENUM.PENDING}`}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.RUNNING} />
        }
        value={running}
        url={`${url}?status=${TASK_STATUS_TYPE_ENUM.RUNNING}`}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.COMPLETED} />
        }
        value={completed}
        url={`${url}?status=${TASK_STATUS_TYPE_ENUM.COMPLETED}`}
      />
      <Divider orientation="vertical" flexItem />
      <TaskInfoCard
        label={
          <JobRunStatusCellRenderer status={TASK_STATUS_TYPE_ENUM.ERRORED} />
        }
        value={errored}
        url={`${url}?status=${TASK_STATUS_TYPE_ENUM.ERRORED}`}
      />
    </Card>
  );
};

export default JobRunTaskCard;
