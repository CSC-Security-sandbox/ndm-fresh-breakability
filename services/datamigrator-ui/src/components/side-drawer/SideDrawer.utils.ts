import {
  setDrawerClose,
  setDrawerOpen,
} from "@store/reducer/commonComponentSlice";
import { Dispatch } from "@reduxjs/toolkit";
import { ReactNode } from "react";

interface DrawerPropsType {
  isOpen: boolean;
  id: string;
  content: ReactNode;
}

export const drawerFunctions = (
  drawerProps: DrawerPropsType,
  dispatch: Dispatch
) => {
  const openDrawer = (id: string, content: ReactNode) => {
    const dispatchDrawerOpen = () =>
      dispatch(
        setDrawerOpen({
          id,
          content,
        })
      );

    if (drawerProps.isOpen === true && drawerProps.id !== id) {
      dispatch(setDrawerClose());
      setTimeout(dispatchDrawerOpen, 300);
    } else {
      dispatchDrawerOpen();
    }
  };
  return {
    openDrawer,
  };
};
