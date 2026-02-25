import { Box } from "@components/container/index";
import {
  MigrationConflictDetail,
  MigrationConflictErrorPropsType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";
import {
  AccordionCard,
  AccordionCardContent,
  AccordionController,
} from "@netapp/bxp-design-system-react";
import { memo } from "react";
import RenderEach from "@components/render-each/RenderEach";
import { Show } from "@components/show/Show";
import { JOB_CONFIG_STATUS_ENUM } from "@/types/app.type";

const MigrationConflictErrors = ({
  conflictData,
}: MigrationConflictErrorPropsType) => {
  return (
    <Box className="flex flex-col gap-3 mb-4">
      <AccordionController>
        <AccordionCard
          title={
            <Box className="flex flex-row gap-2 items-center">
              <Box className="text-red-600 font-semibold">
                Conflicts Detected
              </Box>
              <Box className="text-sm text-gray-600">
                {conflictData.length} conflict
                {conflictData.length > 1 ? "s" : ""} found
              </Box>
            </Box>
          }
        >
          <AccordionCardContent className="mt-2">
            <Box className="text-sm text-gray-700 mb-3">
              The following jobs conflict with your current
              selection:
            </Box>

            <RenderEach
              renderList={conflictData}
              renderItem={(
                conflict: MigrationConflictDetail,
                index: number
              ) => {
                return (
                  <Box className="mb-4 p-4 bg-gray-50 rounded-lg border-l-4 border-l-orange-400">
                    <Box className="font-medium text-sm mb-2">
                      Conflict {index + 1}:
                    </Box>
                    <Box className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Job ID:</span>
                        <span className="text-xs font-mono text-gray-700">
                          {conflict.jobId}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Job Type:</span>
                        <span className="px-2 py-1 rounded text-xs uppercase font-semibold bg-blue-100 text-blue-800">
                          {conflict.jobType === 'CUT_OVER' ? 'CUTOVER' : conflict.jobType}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Conflict Type:</span>
                        <span className="px-2 py-1 rounded text-xs uppercase font-semibold bg-red-100 text-red-800">
                          {conflict.conflictType === 'circular'
                            ? 'CIRCULAR TRANSFER'
                            : conflict.conflictType === 'destination'
                              ? 'DESTINATION'
                              : 'SOURCE'}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Status:</span>
                        <span className={`px-2 py-1 rounded text-xs uppercase font-semibold ${
                          conflict.status === JOB_CONFIG_STATUS_ENUM.INACTIVE 
                            ? 'bg-red-100 text-red-800' 
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {conflict.status}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Source Export Path:</span>
                        <span className="text-xs font-mono text-gray-700">
                          {conflict.sourcePathId}
                        </span>
                      </Box>
                      {(conflict.sourceDirectoryPath ?? "") !== "" && (
                        <Box className="flex items-center gap-2">
                          <span className="font-medium">Source Directory Path:</span>
                          <span className="text-xs font-mono text-gray-700">
                            {conflict.sourceDirectoryPath}
                          </span>
                        </Box>
                      )}
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Target Export Path:</span>
                        <span className="text-xs font-mono text-gray-700">
                          {conflict.targetPathId}
                        </span>
                      </Box>
                      {(conflict.targetDirectoryPath ?? "") !== "" && (
                        <Box className="flex items-center gap-2">
                          <span className="font-medium">Target Directory Path:</span>
                          <span className="text-xs font-mono text-gray-700">
                            {conflict.targetDirectoryPath}
                          </span>
                        </Box>
                      )}
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Source File Server:</span>
                        <span className="text-sm text-gray-700">
                          {conflict.sourceServerId || "N/A"}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Target File Server:</span>
                        <span className="text-sm text-gray-700">
                          {conflict.targetServerId || "N/A"}
                        </span>
                      </Box>
                    </Box>
                  </Box>
                );
              }}
            />

            <Box className="mt-4 p-3 bg-blue-50 rounded-lg border-l-4 border-l-blue-400">
              <Box className="text-sm text-blue-800">
                <Box className="font-medium mb-1">Resolution:</Box>
                {(() => {
                  const hasCircular = conflictData.some(conflict => conflict.conflictType === 'circular');
                  const hasDestination = conflictData.some(conflict => conflict.conflictType === 'destination');
                  const hasSource = conflictData.some(conflict => conflict.conflictType === 'source');
                  const hasDirectoryLevelConflict = conflictData.some(
                    conflict =>
                      (conflict.sourceDirectoryPath != null && conflict.sourceDirectoryPath !== '') ||
                      (conflict.targetDirectoryPath != null && conflict.targetDirectoryPath !== '')
                  );
                  const destinationResolution = hasDestination
                    ? hasDirectoryLevelConflict
                      ? "The destination (or source) directory overlaps with an active job. Choose a different source or destination directory that does not overlap, or delete the conflicting job config(s)."
                      : "Another job already uses this destination path. Delete the conflicting job(s), or choose a different destination."
                    : "";
                  if (hasCircular && (hasDestination || hasSource)) {
                    return "Multiple conflict types detected. Please delete the conflicting job configurations to resolve all conflicts.";
                  } else if (hasCircular) {
                    return "A circular transfer has been detected. Please resolve by deleting the conflicting jobs.";
                  } else if (hasDestination) {
                    return destinationResolution;
                  } else if (hasSource) {
                    return "A source path overlap (parent-child) has been detected. The same source path with overlapping directories is already used by another active job. Please delete the conflicting job configurations.";
                  } else {
                    return "Please resolve these conflicts by deleting the job configurations.";
                  }
                })()}
              </Box>
            </Box>
          </AccordionCardContent>
        </AccordionCard>
      </AccordionController>
    </Box>
  );
};

export default memo(MigrationConflictErrors);
