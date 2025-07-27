import { useDispatch, useSelector } from "react-redux";
import { drawerFunctions } from "@components/side-drawer/SideDrawer.utils";
import { RootStateType } from "@store/store";
import { setDrawerClose } from "@/store/reducer/commonComponentSlice";
import React from "react";

export const useDrawerNavigation = (
  openDrawerProp: string,
  helpComponent?: React.JSX.Element
) => {
  const drawerProps = useSelector(
    (state: RootStateType) => state?.commonComponentSlice?.drawerProps
  );
  const dispatch = useDispatch();
  const { openDrawer } = drawerFunctions(drawerProps, dispatch);

  const handleCloseDrawer = () => {
    dispatch(setDrawerClose());

    if (helpComponent) {
      openDrawer(openDrawerProp, helpComponent);
    }
  };

  return {
    handleCloseDrawer,
  };
};
