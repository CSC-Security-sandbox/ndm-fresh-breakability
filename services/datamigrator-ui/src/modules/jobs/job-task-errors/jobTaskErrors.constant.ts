import React from "react";
import { BlueXpTableRowType, JobErrorType } from "@/types/app.type";
import ValueCellRenderer from "@modules/jobs/job-task-errors/components/ValueCellRenderer";
import TooltipCellRenderer from "@modules/jobs/job-task-errors/components/TooltipCellRenderer";
export const ERROR_COLUMN_DEF = [
  {
    header: "File",
    accessor: "fileName",
    id: "1",
    Renderer: (props: BlueXpTableRowType<JobErrorType, string>) =>
      React.createElement(TooltipCellRenderer, { ...props }),
  },
  {
    header: "Operation",
    accessor: "operationType",
    id: "2",
    Renderer: (props: BlueXpTableRowType<JobErrorType, string>) =>
      React.createElement(ValueCellRenderer, { ...props }),
  },
  {
    header: "Occurrence",
    accessor: "occurrence",
    id: "3",
    Renderer: (props: BlueXpTableRowType<JobErrorType, string>) =>
      React.createElement(ValueCellRenderer, { ...props }),
  },
  {
    header: "Code",
    accessor: "errorCode",
    id: "4",
  },
  {
    header: "Origin",
    accessor: "origin",
    id: "5",
    Renderer: (props: BlueXpTableRowType<JobErrorType, string>) =>
      React.createElement(ValueCellRenderer, { ...props }),
  },
  {
    header: "Error Details",
    accessor: "errorMessage",
    id: "6",
    Renderer: (props: BlueXpTableRowType<JobErrorType, string>) =>
      React.createElement(TooltipCellRenderer, { ...props }),
  },
];

export const GENERATING_ERRORS_LOGS_LABEL =
  "Generating Error Logs, please wait";
