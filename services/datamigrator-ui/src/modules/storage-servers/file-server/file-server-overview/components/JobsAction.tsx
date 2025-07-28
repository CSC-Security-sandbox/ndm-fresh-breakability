import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import { ConfigListTypeApiType } from "@/types/app.type";
import { Button } from "@netapp/bxp-design-system-react";
import { EditIcon } from "@netapp/bxp-style/react-icons/Action";
import { useNavigate } from "react-router-dom";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";

const JobsAction = ({
  fileServerDetails,
}: {
  fileServerDetails: ConfigListTypeApiType;
}) => {
  const navigate = useNavigate();
  const pathname = window.location.pathname;

  const isActive = fileServerDetails?.status === FILE_SERVER_STATUS_ENUM.ACTIVE;

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
            disabled={!isActive}
            onClick={() => navigate(`${pathname}/bulk-discover`)}
          >
            Bulk Discover
          </Button>
          <Button
            disabled={!isActive}
            onClick={() => navigate(`${pathname}/bulk-migrate`)}
          >
            Bulk Migrate
          </Button>
          <Button
            disabled={!isActive}
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
