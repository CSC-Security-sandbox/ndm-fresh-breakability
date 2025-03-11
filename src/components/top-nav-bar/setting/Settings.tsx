import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { drawerFunctions } from "@components/side-drawer/SideDrawer.utils";
import { Button } from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import { useDispatch, useSelector } from "react-redux";
import SettingsContent from "./SettingsContent";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import Help from "@components/top-nav-bar/help/help";

const Settings = () => {
  const drawerId = "Settings";
  const drawerProps = useSelector(
    (state: RootStateType) => state?.commonComponentSlice?.drawerProps
  );
  const dispatch = useDispatch();
  const { openDrawer } = drawerFunctions(drawerProps, dispatch);
  const showSettings = () => openDrawer(drawerId, <SettingsContent />);
  const showHelp = () => openDrawer("help", <Help />);
  return (
    <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageProject}>
      <Button onClick={showSettings} variant="icon">
        <img
          src={"setting.svg"}
          alt="settings"
          height={45}
          width={45}
          className="filter-white-color"
        />
      </Button>

      <Button onClick={showHelp} variant="icon">
        <HelpIcon color="on-color" />
      </Button>
    </PermissionAuth>
  );
};

export default Settings;
