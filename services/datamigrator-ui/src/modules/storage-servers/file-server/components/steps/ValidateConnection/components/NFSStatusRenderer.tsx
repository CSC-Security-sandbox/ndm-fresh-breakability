import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { BlueXpTableRowType, GetAllWorkersApiType } from "@/types/app.type";
import { Popover, InlineLoader } from "@netapp/bxp-design-system-react";
import React, { useContext } from "react";
import { PopoverWrapperType } from "@modules/storage-servers/file-server/fileServer.interface";

const NFSStatusRenderer = (
  params: BlueXpTableRowType<GetAllWorkersApiType, GetAllWorkersApiType>
) => {
  const { workerId } = params?.row ?? {};

  const {
    selectedWorkerIds,
    validateConnectionLoader,
    nfsFailedWorkersIds,
    nfsValidatedWorkersIds,
    errorMessageList,
    nfsCredentialsForm,
  } = useContext(CommonFileServerContext);

  if (!nfsCredentialsForm.isValid) {
    return "-";
  }

  if (selectedWorkerIds.includes(workerId) && validateConnectionLoader) {
    return <InlineLoader />;
  }

  if (nfsFailedWorkersIds.includes(workerId)) {
    const workerError = errorMessageList.find(
      (worker) => worker.workerId === workerId
    );

    return (
      <PopoverWrapper
        status="urgent-notice"
        message={workerError?.errorMessage}
      />
    );
  }

  if (nfsValidatedWorkersIds.includes(workerId)) {
    return <PopoverWrapper status="success" message="" />;
  }
  return "-";
};

const PopoverWrapper = ({ status, message = "" }: PopoverWrapperType) => {
  return <Popover Trigger={status}>{message}</Popover>;
};

export default React.memo(NFSStatusRenderer);
