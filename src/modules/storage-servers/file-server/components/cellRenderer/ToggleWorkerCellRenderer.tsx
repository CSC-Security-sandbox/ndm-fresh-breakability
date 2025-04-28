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
  }, [value]);

  const isOnline = row?.status === "Online";

  return (
    <Toggle
      value={selectedWorkerIds.includes(value)}
      disabled={
        validateConnectionLoader ||
        isJobRunning ||
        (!selectedWorkerIds.includes(value) && !isOnline)
      }
      toggle={handleToggle}
    />
  );
};

export default ToggleWorkerCellRenderer;
