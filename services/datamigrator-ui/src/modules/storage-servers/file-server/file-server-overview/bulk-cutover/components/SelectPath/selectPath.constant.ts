import DiscoveryJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/DiscoveryJobsCountRenderer";
import MigrationJobsCountRenderer from "@modules/storage-servers/file-server/file-server-overview/components/CellRenderer/MigrationJobsCountRenderer";

export const SELECT_PATH_COL_DEFS = [
  {
    id: 1,
    header: "Source Export Path",
    accessor: "sourcePath.sourcePathName",
  },
  {
    id: 2,
    header: "Source Directory Path",
    accessor: "sourceDirectoryPath",
    sort: { enabled: false },
    Renderer: ({ value }: any) => value || "-",
  },
  {
    id: 3,
    header: "Destination File Server",
    accessor: "destinationFileServer.destinationFileServerName",
  },
  {
    id: 4,
    header: "Destination Export Path",
    accessor: "destinationPath.destinationPathName",
  },
  {
    id: 5,
    header: "Destination Directory Path",
    accessor: "destinationDirectoryPath",
    sort: { enabled: false },
    Renderer: ({ value }: any) => value || "-",
  },
  {
    id: 6,
    header: "Protocol",
    accessor: "protocol",
  },
];

export const SELECT_PATH_WARNING_MESSAGE = `I understand Cutover requires downtime during the final sync and have stopped applications and removed write access to source shares/exports. I am responsible for not deleting or modifying source data (including any source data backups I may have) until I have verified access to migrated data and have successfully concluded that my migration is successful. I acknowledge that failure to disconnect clients on the source or premature source deletion may cause data loss, for which I assume full liability.`;

export const REVIEW_WARNING_MESSAGE = `I am okay to initiate Bulk cutover, with current jobs running in parallel.`;
