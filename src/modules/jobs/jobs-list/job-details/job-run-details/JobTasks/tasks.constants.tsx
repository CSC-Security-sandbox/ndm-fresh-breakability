import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import { BlueXpTableRowType, TasksApiType } from "@/types/app.type";

export const TASKS_COLUMN_DEFS = [
  {
    header: "Task",
    accessor: "id",
    id: "taskId",
    width: 100,
    sort: {
      enabled: false,
    },
  },
  {
    header: "Status",
    accessor: "status",
    id: "status",
    width: 100,
    Renderer: ({
      value,
    }: BlueXpTableRowType<TasksApiType, TasksApiType["status"]>) => (
      <JobRunStatusCellRenderer status={value} />
    ),
    sort: {
      enabled: false,
    },
  },
  {
    header: "Worker",
    accessor: "workerId",
    id: "worker",
    width: 100,
    sort: {
      enabled: false,
    },
  },
  {
    header: "Task Type",
    accessor: "taskType",
    id: "taskType",
    width: 100,
    sort: {
      enabled: false,
    },
  },
  {
    header: "Start Time",
    accessor: "createdAt",
    id: "createdAt",
    width: 80,
    Renderer: ({
      value,
    }: BlueXpTableRowType<TasksApiType, TasksApiType["createdAt"]>) => (
      <DateCellRenderer value={value} />
    ),
  },
  {
    header: "End Time",
    accessor: "updatedAt",
    id: "updatedAt",
    width: 80,
    Renderer: ({
      value,
    }: BlueXpTableRowType<TasksApiType, TasksApiType["updatedAt"]>) => (
      <DateCellRenderer value={value} />
    ),
  },
];
