import { drawerFunctions } from "@components/side-drawer/SideDrawer.utils";
import SettingsContent from "@components/top-nav-bar/setting/SettingsContent";
import { Button } from "@netapp/bxp-design-system-react";
import { IAMIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import { RootStateType } from "@store/store";
import { useDispatch, useSelector } from "react-redux";
import Help from "@modules/Help/Help";

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
    <>
      <Button onClick={showSettings} variant="icon">
        <IAMIcon className="filter-white-color" />
      </Button>

      <Button onClick={showHelp} variant="icon">
        <HelpIcon color="on-color" />
      </Button>
    </>
  );
};

export default Settings;
