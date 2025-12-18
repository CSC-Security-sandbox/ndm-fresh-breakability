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
    serverTypeForm,
    activeZoneId,
    zoneWorkerAssignments,
    setZoneWorkerAssignments,
  } = useContext(CommonFileServerContext);

  // Determine if we're in Dell Isilon mode
  const isDellIsilon = serverTypeForm?.formState?.serverType?.value === "dell";

  // Determine worker protocol type from row data
  const getWorkerProtocol = (): 'nfs' | 'smb' => {
    // Use protocol field if available, otherwise fallback to name prefix
    if (row?.protocol) {
      return row.protocol.toLowerCase() === 'smb' ? 'smb' : 'nfs';
    }
    const workerName = row?.workerName?.toLowerCase() || "";
    return workerName.startsWith("smb-") ? 'smb' : 'nfs';
  };

  const handleToggle = useCallback(() => {
    if (isDellIsilon && activeZoneId) {
      // Dell Isilon: Update zoneWorkerAssignments for the active zone
      const workerProtocol = getWorkerProtocol();
      
      setZoneWorkerAssignments((prev: Record<string, { nfs: string[]; smb: string[] }>) => {
        const currentZoneAssignments = prev[activeZoneId] || { nfs: [], smb: [] };
        const currentWorkers = currentZoneAssignments[workerProtocol] || [];
        
        let updatedWorkers: string[];
        if (currentWorkers.includes(value)) {
          // Remove worker
          updatedWorkers = currentWorkers.filter((id: string) => id !== value);
        } else {
          // Add worker
          updatedWorkers = [...currentWorkers, value];
        }
        
        return {
          ...prev,
          [activeZoneId]: {
            ...currentZoneAssignments,
            [workerProtocol]: updatedWorkers,
          },
        };
      });
    } else {
      // Other NAS: Update selectedWorkerIds
      setSelectedWorkerIds((prevIds: string[]) => {
        if (prevIds.includes(value)) {
          return prevIds.filter((id: string) => id !== value);
        } else {
          return [...prevIds, value];
        }
      });
    }
  }, [value, isDellIsilon, activeZoneId, setSelectedWorkerIds, setZoneWorkerAssignments, row]);

  const isOnline = row?.status === "Online";
  
  // Determine if worker is selected based on mode
  const isSelected = (() => {
    if (isDellIsilon && activeZoneId) {
      const workerProtocol = getWorkerProtocol();
      const assignments = zoneWorkerAssignments?.[activeZoneId];
      const workerList = assignments?.[workerProtocol] || [];
      return workerList.includes(value);
    }
    return selectedWorkerIds.includes(value);
  })();

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
