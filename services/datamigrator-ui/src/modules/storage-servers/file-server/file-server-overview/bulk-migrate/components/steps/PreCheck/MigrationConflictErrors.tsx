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
                Migration Conflicts Detected
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
              The following active migration jobs conflict with your current
              selection:
            </Box>

            <RenderEach
              renderList={conflictData}
              renderItem={(
                conflict: MigrationConflictDetail,
                index: number
              ) => {
                console.log('conflict.status:', conflict.status, 'INACTIVE enum:', JOB_CONFIG_STATUS_ENUM.INACTIVE);
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
                          {conflict.conflictType === 'circular' ? 'CIRCULAR TRANSFER' : 'DESTINATION'}
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
                        <span className="font-medium">Source Path:</span>
                        <span className="text-xs font-mono text-gray-700">
                          {conflict.sourcePathId}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Target Path:</span>
                        <span className="text-xs font-mono text-gray-700">
                          {conflict.targetPathId}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Source Server:</span>
                        <span className="text-sm text-gray-700">
                          {conflict.sourceServerId || "N/A"}
                        </span>
                      </Box>
                      <Box className="flex items-center gap-2">
                        <span className="font-medium">Target Server:</span>
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
                  
                  if (hasCircular && hasDestination) {
                    return "Multiple conflict types detected. For circular transfer conflicts, please deactivate the conflicting jobs. For destination path conflicts, please delete the conflicting jobs.";
                  } else if (hasCircular) {
                    return "A circular transfer has been detected. Please resolve these conflicts by deactivating the conflicting jobs.";
                  } else {
                    return "Please resolve these conflicts by deleting the jobs.";
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
