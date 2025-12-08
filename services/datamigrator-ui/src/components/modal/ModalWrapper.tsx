/* eslint-disable */
import {
  Modal,
  ModalHeader,
  ModalContent,
  ModalFooter,
} from "@netapp/bxp-design-system-react";
import { useSelector } from "react-redux";
import { RootStateType } from "@/store/store";

const ModalWrapper = () => {
  const modalProps = useSelector(
    (state: RootStateType) => state.commonComponentSlice?.modalProps
  );

  return (
    <>
      {modalProps?.isOpen && (
        <Modal className={modalProps?.modalClassName}
          style={modalProps?.modalStyle}>
          <ModalHeader>{modalProps?.modalHeader}</ModalHeader>
          <ModalContent>{modalProps?.modalContent}</ModalContent>
          {modalProps?.modalFooter && (
            <ModalFooter
              warning={modalProps?.footerWarning}
              error={modalProps?.footerError}
            >
              {modalProps?.modalFooter}
            </ModalFooter>
          )}
        </Modal>
      )}
    </>
  );
};

export default ModalWrapper;
