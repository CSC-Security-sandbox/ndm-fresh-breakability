import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@/auth/auth.constant";
import { drawerFunctions } from "@components/side-drawer/SideDrawer.utils";
import { Button } from "@netapp/bxp-design-system-react";
import { SettingsIcon } from "@netapp/bxp-style/react-icons/Action";
import { RootStateType } from "@store/store";
import { useDispatch, useSelector } from "react-redux";
import SettingsContent from "./SettingsContent";

const Settings = () => {
  const drawerId = "Settings";
  const drawerProps = useSelector(
    (state: RootStateType) => state?.commonComponentSlice?.drawerProps
  );
  const dispatch = useDispatch();
  const { openDrawer } = drawerFunctions(drawerProps, dispatch);
  const showSettings = () => openDrawer(drawerId, <SettingsContent />);

  return (
    <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageProject}>
      <Button onClick={showSettings} variant="icon">
        <SettingsIcon color="on-color" />
      </Button>
    </PermissionAuth>
  );
};

export default Settings;
