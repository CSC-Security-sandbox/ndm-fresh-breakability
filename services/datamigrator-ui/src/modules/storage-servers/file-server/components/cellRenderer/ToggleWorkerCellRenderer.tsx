import { BlueXpTableRowType } from "@/types/app.type";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Toggle } from "@netapp/bxp-design-system-react";
import { useCallback, useContext } from "react";

const ToggleWorkerCellRenderer = ({
  value,
  row,
}: BlueXpTableRowType<any, string>) => {
  const {
    selectedWorkerIds,
    setSelectedWorkerIds,
    validateConnectionLoader,
    isJobRunning,
    nfsCredentialsForm,
    smbCredentialsForm,
  } = useContext(CommonFileServerContext);

  const handleToggle = useCallback(() => {
    setSelectedWorkerIds((prevIds: string[]) => {
      if (prevIds.includes(value)) {
        return prevIds.filter((id: string) => id !== value);
      } else {
        return [...prevIds, value];
      }
    });
  }, [value, setSelectedWorkerIds]);

  const isOnline = row?.status === "Online";
  const isSelected = selectedWorkerIds.includes(value);
  const workerName = row?.workerName?.toLowerCase() || "";

  const isWorkerTypeValid =
    (nfsCredentialsForm.isValid && workerName.startsWith("nfs-")) ||
    (smbCredentialsForm.isValid && workerName.startsWith("smb-"));

  const isDisabled = (() => {
    if (!isWorkerTypeValid) return true; //if worker type is not valid disable it
    if (validateConnectionLoader) return true; //if connection is being validated disable it
    // if (isJobRunning && isOnline) return true;
    if (isJobRunning) {
      if (!isOnline || (isOnline && isSelected)) return true;
    } //if job is running and worker is offline or online and selected disable it
    // if (isJobRunning && !isOnline) return true; //if job is running and worker is offline disable it
    // if (isJobRunning && isOnline && isSelected) return true; //if worker is selected,online and job is running disable it
    if (!isSelected && !isOnline && !isJobRunning) return true; //if worker is not selected,offline and job is not running disable it

    return false;
  })();

  return (
    <Toggle value={isSelected} disabled={isDisabled} toggle={handleToggle} />
  );
};

export default ToggleWorkerCellRenderer;
