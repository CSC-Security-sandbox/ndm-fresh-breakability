import StatusCellRenderer from "@components/custom-cell-renderer/JobRunStatusCellRenderer";
import { BlueXpTableRowType } from "@/types/app.type";
import React from "react";

export const WORKERS_COLUMN_DEF = [
  {
    header: "Workers",
    accessor: "workerName",
    id: 1,
  },
  {
    header: "Address",
    accessor: "ipAddress",
    id: 2,
  },
  {
    header: "Status",
    accessor: "status",
    id: 3,
    Renderer: ({ value }: BlueXpTableRowType<any, string>) =>
      React.createElement(StatusCellRenderer, {
        status: value,
        active: value.toLocaleLowerCase() === "online",
      }),
  },
];
