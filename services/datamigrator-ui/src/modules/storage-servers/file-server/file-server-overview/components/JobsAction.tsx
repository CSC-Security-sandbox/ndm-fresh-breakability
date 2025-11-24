import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import { ConfigListTypeApiType, VolumeType } from "@/types/app.type";
import { Button } from "@netapp/bxp-design-system-react";
import { EditIcon } from "@netapp/bxp-style/react-icons/Action";
import { useNavigate } from "react-router-dom";
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

  const isActive = fileServerDetails?.status === FILE_SERVER_STATUS_ENUM.ACTIVE;

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

  return (
    <Box className="flex justify-between align-middle">
      <Box className="text-xl flex gap-3">
        <Box className="text-lg">File Server Overview:</Box>
        <Box className="text-lg font-semibold flex gap-3">
          {fileServerDetails?.configName}
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
            onClick={() => navigate(`${pathname}/bulk-discover`)}
          >
            Bulk Discover
          </Button>
          <Button
            disabled={areExportPathsInvalid}
            onClick={() => navigate(`${pathname}/bulk-migrate`)}
          >
            Bulk Migrate
          </Button>
          <Button
            disabled={areExportPathsInvalid}
            onClick={() => navigate(`${pathname}/bulk-cutover`)}
          >
            Bulk Cutover
          </Button>
        </PermissionAuth>
      </Box>
    </Box>
  );
};

export default JobsAction;
