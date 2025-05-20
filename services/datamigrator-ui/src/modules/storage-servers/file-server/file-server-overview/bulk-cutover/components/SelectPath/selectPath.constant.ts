import DiscoveryJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/DiscoveryJobsCountRenderer";
import MigrationJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/MigrationJobsCountRenderer";

export const SELECT_PATH_COL_DEFS = [
  {
    id: 1,
    header: "Source Path",
    accessor: "sourcePath.sourcePathName",
  },
  {
    id: 2,
    header: "Protocol",
    accessor: "protocol",
  },
  {
    id: 3,
    header: "Destination",
    accessor: "destinationFileServer.destinationFileServerName",
  },
  {
    id: 4,
    header: "Destination Path",
    accessor: "destinationPath.destinationPathName",
  },
  {
    id: 5,
    header: "Discovery",
    accessor: "jobConfig",
    popoverText: "Running / Completed / Total Job Runs",
    Renderer: DiscoveryJobsCountRenderer,
  },
  {
    id: 6,
    header: "Migration",
    popoverText: "Running / Completed / Total Job Runs",
    accessor: "jobConfig",
    Renderer: MigrationJobsCountRenderer,
  },
  {
    id: 7,
    header: "Cutover",
    popoverText: "Running / Completed / Total Job Runs",
    accessor: "jobConfig",
    Renderer: DiscoveryJobsCountRenderer,
  },
];

export const SELECT_PATH_WARNING_MESSAGE = `I understand that Cutover requires downtime for the duration of the final sync. I have stopped the applications relying on the source shares/exports and removed write access before 
proceeding. I understand that failure to disconnect active clients may result in data-loss.`;

export const REVIEW_WARNING_MESSAGE = `I am okay to initiate Bulk cutover, with current jobs running in parallel.`;
