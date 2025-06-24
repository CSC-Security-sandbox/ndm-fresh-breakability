import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";
import JobRunStatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import { BlueXpTableRowType, TasksApiType } from "@/types/app.type";
import { toTitleCase } from "@/utils/common.utils";
import TooltipCopyCellRenderer from "@components/custom-cell-renderer/TooltipCopyCellRenderer";

export const TASKS_COLUMN_DEFS = [
  {
    header: "Task",
    accessor: "id",
    id: "taskId",
    width: 100,
    sort: {
      enabled: false,
    },
    Renderer: ({
      value,
    }: BlueXpTableRowType<TasksApiType, TasksApiType["id"]>) =>
      TooltipCopyCellRenderer(value),
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
    accessor: "workerName",
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
    Renderer: ({
      value,
    }: BlueXpTableRowType<TasksApiType, TasksApiType["taskType"]>) =>
      toTitleCase(value),
  },
  {
    header: "Start Time (UTC)",
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
    header: "End Time (UTC)",
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
