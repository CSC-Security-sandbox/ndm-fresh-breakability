import React from "react";
import JobTaskErrorsCellRenderer from "@modules/jobs/job-task-errors/components/JobTaskErrorsCellRenderer";
import { BlueXpTableRowType, JobErrorType } from "@/types/app.type";
export const ERROR_COLUMN_DEF = [
  {
    header: "File",
    accessor: "fileName",
    id: "1",
  },
  {
    header: "Operation",
    accessor: "operationType",
    id: "2",
  },
  {
    header: "Occurrence",
    accessor: "occurrence",
    id: "3",
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
  },
  {
    header: "Error Details",
    accessor: "errorMessage",
    Renderer: (props: BlueXpTableRowType<JobErrorType, string>) =>
      React.createElement(JobTaskErrorsCellRenderer, { ...props }),
    id: "6",
  },
];
