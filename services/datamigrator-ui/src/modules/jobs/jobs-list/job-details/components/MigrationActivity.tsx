import { useGetInProcessFilesQuery, useLazyGetInProcessFilesQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import RefreshButton from "@components/refresh-button/RefreshButton";
import {
  Breadcrumbs,
  Button,
  Notification,
  Table,
  Text,
  Tooltip,
  useTable,
} from "@netapp/bxp-design-system-react";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

type InProcessFile = {
  fileName: string;
  fileSize: number | null;
  timeElapsed: number;
};

const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes === undefined) return "-";
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = numBytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
};

const formatDuration = (seconds: number): string => {
  if (!seconds && seconds !== 0) return "-";
  const totalSeconds = Math.floor(seconds);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m ${secs}s`;
};

const COLUMN_DEFS = [
  {
    header: "File",
    accessor: "fileName",
    id: "fileName",
    width: 300,
    sort: { enabled: false },
  },
  {
    header: "Size",
    accessor: "fileSize",
    id: "fileSize",
    Renderer: ({ value }: { value: number | null }) => formatBytes(value),
    width: 150,
    sort: { enabled: false },
  },
  {
    header: "Time Elapsed",
    accessor: "timeElapsed",
    id: "timeElapsed",
    Renderer: ({ value }: { value: number }) => formatDuration(value),
    width: 150,
    sort: { enabled: false },
  },
];

const downloadCSV = (data: InProcessFile[], filename: string) => {
  const header = ["File Name", "File Size"];
  const csvRows = [
    header.join(","),
    ...data.map((row) =>
      [
        `"${row.fileName.replace(/"/g, '""')}"`,
        `"${formatBytes(row.fileSize)}"`,
      ].join(",")
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const IN_PROCESS_FILES_LIMIT = 10;
const EMPTY_TABLE_POLLING_INTERVAL_MS = 5000;

const MigrationActivity = () => {
  const { jobId, jobRunId } = useParams<{ jobRunId: string; jobId: string }>();

  const defaultPollingInterval = Number(
    window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
  );

  const [isTableEmpty, setIsTableEmpty] = useState(true);

  const {
    data: inProcessData,
    isFetching: isLoading,
    refetch,
    error,
  } = useGetInProcessFilesQuery({ jobRunId: jobRunId! }, {
    skip: !jobRunId,
    pollingInterval: isTableEmpty ? EMPTY_TABLE_POLLING_INTERVAL_MS : defaultPollingInterval,
    skipPollingIfUnfocused: true,
  });

  useEffect(() => {
    setIsTableEmpty((inProcessData?.totalCount ?? 0) === 0);
  }, [inProcessData?.totalCount]);

  const [fetchAllInProcessFiles, { isFetching: isDownloading }] = useLazyGetInProcessFilesQuery();

  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadCSV = async () => {
    setDownloadError(null);
    try {
      const result = await fetchAllInProcessFiles({ jobRunId: jobRunId!, all: true }).unwrap();
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toISOString().slice(11, 16).replace(/:/g, "-");
      downloadCSV(result?.data ?? [], `migration-activity-${jobRunId}-${dateStr}_${timeStr}-UTC.csv`);
    } catch (err: unknown) {
      setDownloadError(err instanceof Error ? err.message : String(err) || "Failed to download. Please try again.");
    }
  };

  const rows: InProcessFile[] = inProcessData?.data ?? [];
  const totalCount: number = inProcessData?.totalCount ?? 0;

  const { rowState, sortState, toggleSort } = useTable({
    columns: COLUMN_DEFS,
    rows,
  });

  return (
    <Box className="flex flex-col gap-6">
      <Breadcrumbs>
        <Link to={`/job-details/${jobId}`}>Job Config Details</Link>
        <Link to={`/job-details/${jobId}/run/${jobRunId}`}>
          Job Run Details
        </Link>
        <Box>Migration Activity</Box>
      </Breadcrumbs>
      <Box>
        <Box className="flex items-center justify-between m-2">
          <Box className="text-sm font-medium">
            Files being migrated: <span style={{ fontWeight: 700 }}>{isLoading ? "…" : totalCount}</span>
            {totalCount > IN_PROCESS_FILES_LIMIT && (
              <span className="ml-2" style={{ color: "#6b7280" }}>
                (Showing top {IN_PROCESS_FILES_LIMIT} files by time elapsed)
              </span>
            )}
          </Box>
          <Box className="flex gap-4">
            <RefreshButton isLoading={isLoading} onRefresh={refetch} />
            <Box className="flex">
              <Button
                variant="icon"
                className="w-[17px] h-[17px]"
                disabled={isLoading || isDownloading || totalCount === 0}
                isSubmitting={isDownloading}
                onClick={handleDownloadCSV}
              >
                <DownloadMonochromeIcon />
              </Button>
              <Tooltip>
                <Text>Click to download the full list of in-process files</Text>
              </Tooltip>
            </Box>
          </Box>
        </Box>
        <Table
          isLoading={isLoading}
          headerContainerStyle={{ top: 0 }}
          columns={COLUMN_DEFS}
          rows={rows}
          sortState={sortState || {}}
          toggleSort={toggleSort}
          rowState={rowState}
          noDataLabel="Scanning in progress or Job not running"
        />
      </Box>
      {error && (
        <Box>
          <Notification type="error">
            There was a problem fetching the in-process files data.
          </Notification>
        </Box>
      )}
      {downloadError && (
        <Box>
          <Notification type="error">
            There was a problem downloading the in-process files.
          </Notification>
        </Box>
      )}
    </Box>
  );
};

export default MigrationActivity;
