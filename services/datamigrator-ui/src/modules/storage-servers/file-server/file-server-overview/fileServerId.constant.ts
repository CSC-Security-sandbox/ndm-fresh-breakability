import { FileServerOverviewApi } from "@/types/app.type";
import CutOverJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/CutOverJobsCountRenderer";
import DiscoveryJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/DiscoveryJobsCountRenderer";
import MigrationJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/MigrationJobsCountRenderer";
import React from "react";
import StatusCellRenderer from "@components/custom-cell-renderer/StatusCellRenderer";
import PathsInfoCellRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/PathsInfoCellRenderer";

export const EXPORT_PATHS_TABLE_COLS_DEF = [
  {
    id: 1,
    header: "Export Path",
    accessor: "volumePath",
  },
  {
    id: 2,
    header: "Status",
    Renderer: PathsInfoCellRenderer,
  },
  {
    id: 3,
    header: "Protocol",
    accessor: "protocol",
  },
  {
    // Running/Completed/Total
    id: 4,
    header: "Discovery",
    accessor: "isDiscoveryDone",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: DiscoveryJobsCountRenderer,
  },
  {
    id: 5,
    header: "Migration",
    accessor: "isBaselineMigrationDone",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: MigrationJobsCountRenderer,
  },
  {
    id: 6,
    header: "Cutover",
    accessor: "cutover",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: CutOverJobsCountRenderer,
  },
];

export const WORKERS_PATHS_TABLE_COLS_DEF = [
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
    Renderer: ({ value }: any) =>
      React.createElement(StatusCellRenderer, {
        status: value === "Online" ? "Online" : "Offline",
        active: value === "Online",
      }),
    id: 3,
  },
];

export const InitialFileServerOverviewApiData: FileServerOverviewApi = {
  jobDetails: {
    totalDiscoverJobs: 0,
    totalMigrateJobs: {
      baseLineJob: 0,
      incrementalJob: 0,
    },
    totalCutoverJobs: 0,
  },
  storageDetails: {
    totalDiscoveredSize: "",
    totalMigratedSize: "",
    totalFileServers: 0,
    totalPendingSize: "",
  },
};

export const BULK_DISCOVERY_DEFAULT_COLUMN_STATE = {
  2: { isHidden: true },
};

export const BULK_DISCOVERY = "bulk-discovery";
