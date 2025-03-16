/* eslint-disable */
import { Button } from "@netapp/bxp-design-system-react";
import { setModalClose } from "@store/reducer/commonComponentSlice";
import { useDispatch } from "react-redux";

interface ModalFooterWrapperPropsType {
  primaryAction: Function;
  cancelAction?: Function;
  primaryText?: string;
  primaryActionColor?: string;
}

const ModalFooterWrapper = ({
  primaryAction,
  cancelAction,
  primaryText,
  primaryActionColor,
}: ModalFooterWrapperPropsType) => {
  const dispatch = useDispatch();
  const closeAction = () => {
    cancelAction && cancelAction();
    dispatch(setModalClose());
  };

  return (
    <>
      <Button
        color={primaryActionColor || "destructive"}
        onClick={primaryAction}
      >
        {primaryText || "Delete"}
      </Button>
      <Button onClick={closeAction}>Cancel</Button>
    </>
  );
};

export default ModalFooterWrapper;
