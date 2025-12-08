import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ReactNode } from "react";

interface AppSliceType {
  modalProps: ModalPropsType;
  drawerProps: DrawerPropsType;
}

interface ModalPropsType {
  isOpen: boolean;
  modalHeader: ReactNode;
  modalContent: ReactNode;
  modalFooter: ReactNode;
  modalClassName?: string;
  modalStyle?: React.CSSProperties;
  footerWarning?: ReactNode;
  footerError?: ReactNode;
}
interface DrawerPropsType {
  isOpen: boolean;
  id: string;
  content: ReactNode;
}


const initialState: AppSliceType = {
  modalProps: {} as ModalPropsType,
  drawerProps: {} as DrawerPropsType,
};

export const commonComponentSlice = createSlice({
  name: "commonComponentSlice",
  initialState,
  reducers: {
    setModalProps: (
      state: AppSliceType,
      action: PayloadAction<ModalPropsType>
    ) => {
      state.modalProps = action.payload;
    },

    setModalClose: (state: AppSliceType) => {
      state.modalProps = initialState.modalProps;
    },

    setDrawerOpen: (state, action: PayloadAction<Omit<DrawerPropsType, "isOpen">>) => {
      state.drawerProps = {
        isOpen: true,
        ...action.payload
      };
    },

    setDrawerClose: (state) => {
      state.drawerProps.isOpen = false;
    }
  },
});

export const { setModalProps, setModalClose, setDrawerOpen, setDrawerClose } = commonComponentSlice.actions;
