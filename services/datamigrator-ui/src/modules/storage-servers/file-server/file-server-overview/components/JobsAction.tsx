import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import { ConfigListTypeApiType, VolumeType } from "@/types/app.type";
import { Button } from "@netapp/bxp-design-system-react";
import { EditIcon } from "@netapp/bxp-style/react-icons/Action";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import { useMemo } from "react";

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

  // Check if all export paths are explicitly disabled
  // Note: We allow paths that haven't been validated yet (isValid undefined or false without isDisabled)
  const areAllExportPathsDisabled = useMemo(() => {
    if (!allExportPaths || allExportPaths.length === 0) {
      return true; // If no export paths, consider all disabled
    }
    // Only consider paths as disabled if they are explicitly marked as disabled
    return allExportPaths.every(path => path.isDisabled === true);
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

  return (
    <>
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
