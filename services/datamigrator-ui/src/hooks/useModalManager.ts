import { useDispatch } from "react-redux";
import {
  setModalClose,
  setModalProps,
} from "@store/reducer/commonComponentSlice";
import { ModalConfigPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";

//Custom hook to manage modal dialogs in the application
export const useModalManager = () => {
  const dispatch = useDispatch();

  const openModal = (modalConfig: ModalConfigPropsType) =>
    dispatch(setModalProps({ isOpen: true, ...modalConfig }));

  const closeModal = () => dispatch(setModalClose());

  return { openModal, closeModal };
};
