import { useContext } from "react";
import { Box } from "@components/container";
import { UpgradeContext } from "../context/context";

const StagingProgress = () => {
  const { workerUploadStatus, multicastStatus } = useContext(UpgradeContext);

  if (!workerUploadStatus || workerUploadStatus === "IDLE") return null;

  const summary = multicastStatus?.summary;
  const workers = multicastStatus?.workers || [];
  const isInProgress = workerUploadStatus === "IN_PROGRESS";
  const isCompleted = workerUploadStatus === "COMPLETED";

  const total = summary?.total ?? 0;
  const completed = summary?.completed ?? 0;
  const inProgress = summary?.inProgress ?? 0;
  const failed = summary?.failed ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Box className="mt-4 p-4 rounded border" style={{
      backgroundColor: isCompleted ? '#f0fdf4' : '#eff6ff',
      borderColor: isCompleted ? '#86efac' : '#93c5fd',
    }}>
      <Box className="flex items-center gap-3 mb-2">
        {isInProgress && (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        )}
        {isCompleted && (
          <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        <p className="font-medium" style={{ color: isCompleted ? '#166534' : '#1e40af' }}>
          {isCompleted ? "Worker Binaries Staged" : "Staging Worker Binaries..."}
        </p>
      </Box>

      {total > 0 && (
        <>
          <Box className="w-full bg-gray-200 rounded-full h-2 mb-2">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                backgroundColor: isCompleted ? '#22c55e' : '#3b82f6',
              }}
            />
          </Box>
          <Box className="flex justify-between text-xs text-gray-600 mb-3">
            <span>{completed}/{total} workers</span>
            <span>{progressPct}%</span>
          </Box>
        </>
      )}

      {/* Worker list when done */}
      {inProgress === 0 && workers.length > 0 && (
        <Box className="text-xs space-y-1">
          {workers.map((w) => (
            <Box key={w.workerId} className="flex items-center justify-between py-1 px-2 rounded"
              style={{
                backgroundColor: w.bundleStatus === 'COMPLETED' ? '#f0fdf4' : '#fef2f2',
              }}
            >
              <span style={{ color: w.bundleStatus === 'COMPLETED' ? '#166534' : '#991b1b' }}>
                {w.workerName || w.workerId} — {w.ipAddress || 'N/A'}
              </span>
              <span style={{
                color: w.bundleStatus === 'COMPLETED' ? '#16a34a' : '#dc2626',
                fontWeight: 600,
              }}>
                {w.bundleStatus === 'COMPLETED' ? '✓' : '✗'}
              </span>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default StagingProgress;
