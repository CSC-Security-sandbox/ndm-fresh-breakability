import { drawerFunctions } from "@components/side-drawer/SideDrawer.utils";
import { Button } from "@netapp/bxp-design-system-react";
import { HeaderUserIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { RootStateType } from "@store/store";
import { useDispatch, useSelector } from "react-redux";
import UserDetailsContent from "./UserDetailsContent";

const UserDetails = () => {
  const dispatch = useDispatch();
  const drawerProps = useSelector(
    (state: RootStateType) => state?.commonComponentSlice?.drawerProps
  );
  const { openDrawer } = drawerFunctions(drawerProps, dispatch);
  const showUserDetails = () =>
    openDrawer("UserDetails", <UserDetailsContent />);

  return (
    <Button onClick={showUserDetails} variant="icon">
      <HeaderUserIcon color="on-color" />
    </Button>
  );
};

export default UserDetails;
