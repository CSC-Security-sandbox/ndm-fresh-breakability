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

  // Simplified logic since we only show compatible workers now
  const isDisabled = (() => {
    if (validateConnectionLoader) return true;
    if (isJobRunning && isOnline) return true;
    if (!isSelected && !isOnline && !isJobRunning) return true;
    return false;
  })();

  return (
    <Toggle value={isSelected} disabled={isDisabled} toggle={handleToggle} />
  );
};

export default ToggleWorkerCellRenderer;
