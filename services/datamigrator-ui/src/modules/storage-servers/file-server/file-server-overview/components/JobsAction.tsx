import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import { ConfigListTypeApiType, VolumeType } from "@/types/app.type";
import { Button } from "@netapp/bxp-design-system-react";
import { EditIcon } from "@netapp/bxp-style/react-icons/Action";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import { useMemo, useCallback } from "react";
import ExploreModal, { useExploreModal, SelectedItemInfo } from "./ExploreModal";

const JobsAction = ({
  fileServerDetails,
  allExportPaths,
}: {
  fileServerDetails: ConfigListTypeApiType;
  allExportPaths: VolumeType[];
}) => {
  const navigate = useNavigate();
  const pathname = window.location.pathname;
  const [searchParams] = useSearchParams();
  
  // Get zone name and fileServerId from query parameters (for Dell Isilon zones)
  const zoneNameParam = searchParams.get('zone');
  const zoneFileServerId = searchParams.get('fileServerId');

  // For Dell Isilon zones, check the zone-level status, not the config-level status
  const isActive = useMemo(() => {
    if (zoneFileServerId && fileServerDetails?.fileServers) {
      // Find the specific zone's file server and check its status
      const zoneFileServer = fileServerDetails.fileServers.find(
        (fs) => fs.id === zoneFileServerId
      );
      // Use type assertion since status exists on file server for Dell Isilon
      return (zoneFileServer as any)?.status === FILE_SERVER_STATUS_ENUM.ACTIVE;
    }
    // For regular NAS, check the config-level status
    return fileServerDetails?.status === FILE_SERVER_STATUS_ENUM.ACTIVE;
  }, [fileServerDetails, zoneFileServerId]);

  // Check if all export paths are disabled (isValid = false or isDisabled = true)
  const areAllExportPathsDisabled = useMemo(() => {
    if (!allExportPaths || allExportPaths.length === 0) {
      return true; // If no export paths, consider all disabled
    }
    return allExportPaths.every(path => path.isValid === false || path.isDisabled === true);
  }, [allExportPaths]);

  // Bulk buttons should be disabled if file server is not active OR all export paths are disabled
  const areExportPathsInvalid = !isActive || areAllExportPathsDisabled;

  const handleEdit = () => {
    navigate(`/edit-file-server/${fileServerDetails?.id}`);
  };

  // Determine display name: use zone name if available, otherwise config name
  // For Dell Isilon zones, show just the zone name
  const displayName = useMemo(() => {
    if (zoneNameParam) {
      // Dell Isilon zone view - show just the zone name
      return decodeURIComponent(zoneNameParam);
    }
    return fileServerDetails?.configName;
  }, [fileServerDetails?.configName, zoneNameParam]);

  // Build query string for navigation - preserve zone and fileServerId for Dell Isilon
  const queryString = useMemo(() => {
    if (zoneFileServerId && zoneNameParam) {
      return `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`;
    }
    return '';
  }, [zoneFileServerId, zoneNameParam]);

  // Initialize explore modal hook
  const { isOpen: isExploreModalOpen, openExploreModal, closeExploreModal } = useExploreModal();

  // Handle confirmed selection from explore modal
  const handleExploreConfirm = useCallback((selectedItems: SelectedItemInfo[], exportPath: VolumeType) => {
    // For now, log the selection. In a real implementation, this would:
    // - Navigate to a job creation page with the selected items
    // - Or trigger some other action based on the selection
    console.log("Selected items:", selectedItems);
    console.log("Export path:", exportPath);
    
    // Example: Navigate to create job with selected paths
    // const selectedPaths = selectedItems.map(item => item.path).join(',');
    // navigate(`${pathname}/create-job?exportPath=${exportPath.id}&paths=${encodeURIComponent(selectedPaths)}${queryString}`);
  }, []);

  return (
    <>
      {/* Explore Modal */}
      <ExploreModal
        isOpen={isExploreModalOpen}
        onClose={closeExploreModal}
        onConfirm={handleExploreConfirm}
        fileServerName={displayName || ""}
        fileServerId={fileServerDetails?.id || ""}
        allExportPaths={allExportPaths}
      />

      <Box className="flex justify-between align-middle">
      <Box className="text-xl flex gap-3">
        <Box className="text-lg">File Server Overview:</Box>
        <Box className="text-lg font-semibold flex gap-3">
          {displayName}
          <PermissionAuth
            permissionName={USER_PERMISSION_TYPE_ENUM.ManageConfig}
          >
            <EditIcon
              size="24"
              className="cursor-pointer"
              onClick={handleEdit}
            />
          </PermissionAuth>
        </Box>
      </Box>
      <Box className="flex justify-end gap-2">
        <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageJob}>
          <Button
            disabled={!isActive}
            onClick={openExploreModal}
          >
            Explore
          </Button>
          <Button
            disabled={areExportPathsInvalid}
            onClick={() => navigate(`${pathname}/bulk-discover${queryString}`)}
          >
            Bulk Discover
          </Button>
          <Button
            disabled={areExportPathsInvalid}
            onClick={() => navigate(`${pathname}/bulk-migrate${queryString}`)}
          >
            Bulk Migrate
          </Button>
          <Button
            disabled={areExportPathsInvalid}
            onClick={() => navigate(`${pathname}/bulk-cutover${queryString}`)}
          >
            Bulk Cutover
          </Button>
        </PermissionAuth>
      </Box>
    </Box>
    </>
  );
};

export default JobsAction;
