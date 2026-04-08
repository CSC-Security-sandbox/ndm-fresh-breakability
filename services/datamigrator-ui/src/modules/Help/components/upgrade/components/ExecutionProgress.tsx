import { useContext } from "react";
import { Box } from "@components/container";
import { UpgradeContext } from "../context/context";
import { WorkerExecutionItem } from "@api/upgradeApi";

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "#166534",
  IN_PROGRESS: "#1e40af",
  FAILED: "#991b1b",
  IDLE: "#6b7280",
};

const STATUS_BG: Record<string, string> = {
  COMPLETED: "#f0fdf4",
  FAILED: "#fef2f2",
  IDLE: "#f9fafb",
};

const WorkerTable = ({
  workers,
  showVersion = false,
}: {
  workers: WorkerExecutionItem[];
  showVersion?: boolean;
}) => {
  if (workers.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="pb-1.5 font-medium">Worker</th>
          <th className="pb-1.5 font-medium">IP Address</th>
          <th className="pb-1.5 font-medium">Platform</th>
          <th className="pb-1.5 font-medium">{showVersion ? "Version" : "Status"}</th>
        </tr>
      </thead>
      <tbody>
        {workers.map((w) => (
          <tr key={w.workerId} className="border-b border-gray-100">
            <td className="py-1.5 text-gray-800">
              {w.workerName || w.workerId.substring(0, 8)}
            </td>
            <td className="py-1.5 text-gray-600 font-mono text-xs">
              {w.ipAddress || "—"}
            </td>
            <td className="py-1.5 text-gray-600 capitalize">
              {w.platform || "—"}
            </td>
            {showVersion ? (
              <td className="py-1.5 text-gray-800 font-mono text-xs">
                {w.currentVersion || "—"}
              </td>
            ) : (
              <td className="py-1.5" style={{ color: STATUS_COLORS[w.executionStatus] || "#6b7280" }}>
                {w.executionStatus}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const ExecutionProgress = () => {
  const {
    isUpgradeExecuting,
    executionStatus,
    workerUpgradeStatus,
    deactivatedConfigIds,
    handleDownloadReport,
    isDownloadingReport,
    handleReactivateJobs,
    isReactivatingJobs,
  } = useContext(UpgradeContext);

  // Determine if we should show this component at all
  const showExecution =
    workerUpgradeStatus === "IN_PROGRESS" ||
    workerUpgradeStatus === "COMPLETED";

  if (!showExecution) return null;

  const noWorkers =
    workerUpgradeStatus === "COMPLETED" && !executionStatus;

  const summary = executionStatus?.summary;
  const upgradeCompleted = executionStatus?.upgradeCompleted ?? false;
  const upgradeStatus = executionStatus?.upgradeStatus;
  const completed = executionStatus?.completed || [];
  const notCompleted = executionStatus?.notCompleted || [];
  const notStaged = executionStatus?.notStaged || [];
  const total = summary?.total ?? 0;
  const responded = (summary?.completed ?? 0) + (summary?.failed ?? 0);
  const progressPct = total > 0 ? Math.round((responded / total) * 100) : 0;

  return (
    <Box className="mt-4 space-y-4">
      {/* CP Upgrade Success Banner — always shown */}
      <Box
        className="p-4 rounded border-l-4 border border-gray-200"
        style={{ backgroundColor: "white", borderLeftColor: "#16a34a" }}
      >
        <Box className="flex items-center gap-3">
          <svg
            className="h-5 w-5"
            style={{ color: "#16a34a" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="font-medium" style={{ color: "#166534" }}>
            Control Plane upgraded successfully
          </p>
        </Box>
      </Box>

      {/* No Workers Case */}
      {noWorkers && (
        <Box
          className="p-4 rounded border-l-4 border border-gray-200"
          style={{ backgroundColor: "white", borderLeftColor: "#16a34a" }}
        >
          <Box className="flex items-center gap-3">
            <svg
              className="h-5 w-5"
              style={{ color: "#16a34a" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p className="font-medium" style={{ color: "#166534" }}>
              No workers to upgrade. Upgrade complete.
            </p>
          </Box>
        </Box>
      )}

      {/* Worker Execution Section */}
      {!noWorkers && (
        <Box
          className="p-4 rounded border-l-4 border border-gray-200"
          style={{
            backgroundColor: "white",
            borderLeftColor: upgradeCompleted
              ? upgradeStatus === "success"
                ? "#16a34a"
                : "#d97706"
              : "#3b82f6",
          }}
        >
          {/* Header */}
          <Box className="flex items-center gap-3 mb-3">
            {isUpgradeExecuting && (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
            )}
            {upgradeCompleted && upgradeStatus === "success" && (
              <svg
                className="h-5 w-5"
                style={{ color: "#16a34a" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            {upgradeCompleted && upgradeStatus !== "success" && (
              <svg
                className="h-5 w-5"
                style={{ color: "#d97706" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z"
                />
              </svg>
            )}
            <p
              className="font-medium"
              style={{
                color: upgradeCompleted
                  ? upgradeStatus === "success"
                    ? "#166534"
                    : "#92400e"
                  : "#1e40af",
              }}
            >
              {isUpgradeExecuting
                ? "Upgrading Workers..."
                : upgradeStatus === "success"
                ? "Worker Upgrade Complete"
                : "Worker Upgrade Completed with Issues"}
            </p>
          </Box>

          {/* Progress Bar (during execution) */}
          {isUpgradeExecuting && total > 0 && (
            <>
              <Box className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPct}%`,
                    backgroundColor: "#3b82f6",
                  }}
                />
              </Box>
              <Box className="flex justify-between text-xs text-gray-600 mb-3">
                <span>
                  {responded}/{total} responded
                </span>
                <span>{progressPct}%</span>
              </Box>
            </>
          )}

          {/* Summary Counts */}
          {summary && (
            <Box className="flex gap-4 text-sm mb-4">
              {summary.completed > 0 && (
                <span style={{ color: "#166534" }}>
                  {summary.completed} completed
                </span>
              )}
              {summary.inProgress > 0 && (
                <span style={{ color: "#1e40af" }}>
                  {summary.inProgress} in progress
                </span>
              )}
              {summary.failed > 0 && (
                <span style={{ color: "#991b1b" }}>
                  {summary.failed} failed
                </span>
              )}
            </Box>
          )}

          {/* Worker Tables — shown after completion */}
          {upgradeCompleted && (
            <Box className="space-y-3">
              {completed.length > 0 && (
                <Box
                  className="p-3 rounded border-l-4 border border-gray-200"
                  style={{ backgroundColor: "white", borderLeftColor: "#16a34a" }}
                >
                  <p
                    className="text-sm font-medium mb-2"
                    style={{ color: STATUS_COLORS.COMPLETED }}
                  >
                    Upgraded ({completed.length})
                  </p>
                  <Box className="max-h-48 overflow-y-auto">
                    <WorkerTable workers={completed} showVersion />
                  </Box>
                </Box>
              )}

              {notCompleted.length > 0 && (
                <Box
                  className="p-3 rounded border-l-4 border border-gray-200"
                  style={{ backgroundColor: "white", borderLeftColor: "#dc2626" }}
                >
                  <p
                    className="text-sm font-medium mb-2"
                    style={{ color: STATUS_COLORS.FAILED }}
                  >
                    Not Completed ({notCompleted.length})
                  </p>
                  <Box className="max-h-48 overflow-y-auto">
                    <WorkerTable workers={notCompleted} />
                  </Box>
                </Box>
              )}

              {notStaged.length > 0 && (
                <Box
                  className="p-3 rounded border-l-4 border border-gray-200"
                  style={{ backgroundColor: "white", borderLeftColor: "#9ca3af" }}
                >
                  <p
                    className="text-sm font-medium mb-2"
                    style={{ color: STATUS_COLORS.IDLE }}
                  >
                    Not Staged ({notStaged.length})
                  </p>
                  <Box className="max-h-48 overflow-y-auto">
                    <WorkerTable workers={notStaged} />
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
      {/* Re-activate Jobs Panel — shown after upgrade completes if configs were deactivated */}
      {(upgradeCompleted || noWorkers) && deactivatedConfigIds?.length > 0 && (
        <Box
          className="p-4 rounded-lg border-l-4 border border-gray-200"
          style={{ backgroundColor: "white", borderLeftColor: "#d97706" }}
        >
          <Box className="flex items-center gap-2 mb-1">
            <svg className="h-5 w-5 flex-shrink-0" style={{ color: "#d97706" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
            </svg>
            <p className="font-semibold text-base" style={{ color: "#92400e" }}>
              Re-activate Job Configurations
            </p>
          </Box>
          <p className="text-sm mb-4 ml-7" style={{ color: "#6F6F6F" }}>
            {deactivatedConfigIds.length} job config(s) were deactivated before upgrade.
            Re-activate them to resume migrations.You can also download the report of all stopped job runs and deactivated job configs.
          </p>
          <Box className="flex justify-end gap-3">
            <button
              onClick={handleDownloadReport}
              disabled={isDownloadingReport}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                border: "1px solid #A7A7A7",
                backgroundColor: "white",
                color: "#404040",
                fontSize: "14px",
                fontWeight: 500,
                cursor: isDownloadingReport ? "not-allowed" : "pointer",
                opacity: isDownloadingReport ? 0.6 : 1,
              }}
            >
              {isDownloadingReport ? 'Generating...' : 'Download Report (CSV)'}
            </button>
            <button
              onClick={handleReactivateJobs}
              disabled={isReactivatingJobs}
              style={{
                padding: "8px 20px",
                borderRadius: "8px",
                backgroundColor: isReactivatingJobs ? "#e0e0e0" : "#0067C5",
                color: isReactivatingJobs ? "#A7A7A7" : "white",
                fontSize: "14px",
                fontWeight: 600,
                cursor: isReactivatingJobs ? "not-allowed" : "pointer",
                border: "none",
                boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                transition: "background-color 0.15s ease",
              }}
              onMouseEnter={(e) => { if (!isReactivatingJobs) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1E4A93"; }}
              onMouseLeave={(e) => { if (!isReactivatingJobs) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0067C5"; }}
            >
              {isReactivatingJobs ? 'Re-activating...' : `Re-activate ${deactivatedConfigIds.length} Config(s)`}
            </button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ExecutionProgress;
