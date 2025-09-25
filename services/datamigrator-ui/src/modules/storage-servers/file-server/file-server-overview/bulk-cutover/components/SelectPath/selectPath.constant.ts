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

export const SELECT_PATH_WARNING_MESSAGE = `I understand Cutover requires downtime during the final sync and have stopped applications and removed write access to source shares/exports. I am responsible for not deleting or modifying source data (including any source data backups I may have) until I have verified access to migrated data and have successfully concluded that my migration is successful. I acknowledge that failure to disconnect clients on the source or premature source deletion may cause data loss, for which I assume full liability.`;

export const REVIEW_WARNING_MESSAGE = `I am okay to initiate Bulk cutover, with current jobs running in parallel.`;
