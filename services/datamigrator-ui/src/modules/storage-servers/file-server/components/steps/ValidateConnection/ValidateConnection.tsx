import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { useContext, useState, useMemo, useEffect } from "react";
import WorkersWithErrorAccordion from "@modules/storage-servers/file-server/components/steps/ValidateConnection/components/WorkersWithErrorAccordion";
import WorkerInstallation from "@components/top-nav-bar/setting/ManageProjects/WorkerInstructions";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { Text, Table, useTable, SearchWidget, TablePager, Layout } from "@netapp/bxp-design-system-react";
import RefreshButton from "@components/refresh-button/RefreshButton";

// Default table state props structure - defined outside component to avoid recreation
const DEFAULT_TABLE_STATE_PROPS = {
  columns: [],
  rows: [],
  isSorting: true,
  pageSize: 10,
};

const ValidateConnection = () => {
  const {
    workersListTableStateProps,
    selectedWorkerIds,
    isFetching,
    refetch,
    selectedProtocol,
    allWorkersList,
    serverTypeForm,
    selectedZoneIds,
    zoneCredentials,
    setSelectedWorkerIds,
    zoneWorkerAssignments,
    setZoneWorkerAssignments,
    activeZoneId,
    setActiveZoneId,
  } = useContext(CommonFileServerContext);

  const { selectedProjectId } = useSelectedProjectId();

  // Dell Isilon specific state - safe defaults
  const isDellIsilon = serverTypeForm?.formState?.serverType?.value === "dell";
  const safeSelectedZoneIds = selectedZoneIds || [];
  const safeZoneCredentials = zoneCredentials || {};
  const safeZoneWorkerAssignments = zoneWorkerAssignments || {};
  const safeAllWorkersList = allWorkersList || [];
  
  // Ensure workersListTableStateProps always has rows property - MUST return a valid object
  // For Other NAS, filter workers based on selectedProtocol
  const safeWorkersListTableStateProps = useMemo(() => {
    if (!workersListTableStateProps || typeof workersListTableStateProps !== 'object') {
      return DEFAULT_TABLE_STATE_PROPS;
    }
    
    // For Other NAS, filter workers by protocol
    const allRows = workersListTableStateProps.rows || [];
    const filteredRows = isDellIsilon 
      ? allRows  // Dell Isilon handles its own filtering per-zone
      : allRows.filter((worker: any) => {
          const workerName = worker?.workerName?.toLowerCase() || "";
          if (selectedProtocol === 'NFS') {
            return workerName.startsWith("nfs-");
          } else if (selectedProtocol === 'SMB') {
            return workerName.startsWith("smb-");
          }
          return false;
        });
    
    return {
      columns: workersListTableStateProps.columns || [],
      rows: filteredRows,
      isSorting: workersListTableStateProps.isSorting ?? true,
      pageSize: workersListTableStateProps.pageSize || 10,
    };
  }, [workersListTableStateProps, isDellIsilon, selectedProtocol]);

  // Initialize activeZoneId when zones are selected (use context's setActiveZoneId)

  // Initialize activeZoneId when zones are selected
  useEffect(() => {
    if (isDellIsilon && safeSelectedZoneIds.length > 0 && !activeZoneId) {
      setActiveZoneId(safeSelectedZoneIds[0]);
    }
  }, [isDellIsilon, safeSelectedZoneIds, activeZoneId]);

  // Get zone details with configured protocols
  const selectedZonesWithDetails = useMemo(() => {
    console.debug("[ValidateConnection] Building zone details", {
      safeSelectedZoneIds,
      safeZoneCredentials,
    });
    return safeSelectedZoneIds.map((zoneId) => {
      const creds = safeZoneCredentials[zoneId] || {};
      // NFS only requires IP and username (password is optional for Isilon)
      const hasNfs = !!(creds.nfsIp && creds.nfsUsername);
      const hasSmb = !!(creds.smbIp && creds.smbUsername && creds.smbPassword);
      console.debug(`[ValidateConnection] Zone ${zoneId}:`, {
        creds,
        hasNfs,
        hasSmb,
        nfsIp: creds.nfsIp,
        nfsUsername: creds.nfsUsername,
        nfsPassword: !!creds.nfsPassword, // Optional - just for logging
        smbIp: creds.smbIp,
        smbUsername: creds.smbUsername,
        smbPassword: !!creds.smbPassword,
      });
      return {
        id: zoneId,
        name: zoneId, // Zone name is the zoneId (zoneName from API)
        hasNfs,
        hasSmb,
        nfsIp: creds.nfsIp,
        smbIp: creds.smbIp,
      };
    });
  }, [safeSelectedZoneIds, safeZoneCredentials]);

  // Get active zone details
  const activeZone = useMemo(() => {
    return selectedZonesWithDetails.find((z) => z.id === activeZoneId);
  }, [selectedZonesWithDetails, activeZoneId]);

  // Filter workers based on active zone's configured protocols
  const filteredWorkersList = useMemo(() => {
    console.debug("[ValidateConnection] Filtering workers", {
      isDellIsilon,
      activeZone,
      safeAllWorkersList: safeAllWorkersList?.length,
      workersDetails: safeAllWorkersList?.map(w => ({ name: w?.workerName, platform: w?.platform })),
    });
    
    if (!isDellIsilon || !activeZone) return safeAllWorkersList;

    const filtered = safeAllWorkersList.filter((worker) => {
      const workerName = worker?.workerName?.toLowerCase() || "";
      if (activeZone.hasNfs && activeZone.hasSmb) {
        // Show both NFS and SMB workers
        return workerName.startsWith("nfs-") || workerName.startsWith("smb-");
      } else if (activeZone.hasNfs) {
        return workerName.startsWith("nfs-");
      } else if (activeZone.hasSmb) {
        return workerName.startsWith("smb-");
      }
      return false;
    });
    
    console.debug("[ValidateConnection] Filtered workers result", {
      activeZoneHasNfs: activeZone?.hasNfs,
      activeZoneHasSmb: activeZone?.hasSmb,
      filteredCount: filtered?.length,
      filteredWorkers: filtered?.map(w => w?.workerName),
    });
    
    return filtered;
  }, [isDellIsilon, activeZone, safeAllWorkersList]);

  // Get selected worker IDs for the active zone
  const activeZoneSelectedWorkers = useMemo(() => {
    if (!activeZoneId) return [];
    const assignments = safeZoneWorkerAssignments[activeZoneId];
    if (!assignments) return [];
    return [...(assignments.nfs || []), ...(assignments.smb || [])];
  }, [activeZoneId, safeZoneWorkerAssignments]);

  // Create table state props for Dell Isilon with filtered workers - MUST return a valid object
  const dellIsilonTableStateProps = useMemo(() => {
    // Base structure that is always valid
    const result = {
      columns: safeWorkersListTableStateProps.columns || [],
      rows: isDellIsilon ? (filteredWorkersList || []) : (safeWorkersListTableStateProps.rows || []),
      isSorting: safeWorkersListTableStateProps.isSorting ?? true,
      pageSize: safeWorkersListTableStateProps.pageSize || 10,
    };
    return result;
  }, [isDellIsilon, safeWorkersListTableStateProps, filteredWorkersList]);

  // Dell Isilon uses its own useTable hook to avoid TableWrapper issues
  const dellIsilonTableState = useTable({
    columns: dellIsilonTableStateProps.columns,
    rows: dellIsilonTableStateProps.rows,
    isSorting: true,
    pageSize: 10,
  });

  const checkDisabled = (row: any) => {
    return row.status !== "Online";
  };

  const getProtocolSpecificLabel = () => {
    if (isDellIsilon && activeZone) {
      if (activeZone.hasNfs && activeZone.hasSmb) {
        return "NFS & SMB Workers";
      } else if (activeZone.hasNfs) {
        return "NFS Workers";
      } else if (activeZone.hasSmb) {
        return "SMB Workers";
      }
    }
    const protocolText = selectedProtocol === "NFS" ? "NFS" : "SMB";
    return `${protocolText} Compatible Workers`;
  };

  const getNoWorkersMessage = () => {
    let protocolText = selectedProtocol === "NFS" ? "NFS" : "SMB";
    if (isDellIsilon && activeZone) {
      if (activeZone.hasNfs && activeZone.hasSmb) {
        protocolText = "NFS or SMB";
      } else if (activeZone.hasNfs) {
        protocolText = "NFS";
      } else if (activeZone.hasSmb) {
        protocolText = "SMB";
      }
    }
    return (
      <div className="text-center px-2 sm:px-4 py-2 text-xs sm:text-sm md:text-base leading-relaxed break-words">
        <span className="inline-block">
          No {protocolText} compatible workers found. Go to{" "}
          <span className="whitespace-nowrap">View Instructions To Setup Worker</span>{" "}
          to setup a worker and then click the refresh icon to make it available for association.
        </span>
      </div>
    );
  };

  // Render the Worker Installation button for the table header
  const renderWorkerInstallationButton = () => {
    const workerList = isDellIsilon ? filteredWorkersList : safeAllWorkersList;
    if (workerList.length === 0) {
      return (
        <Box className="flex-shrink-0">
          <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageConfig}>
            <WorkerInstallation
              label="View Instructions To Setup Worker"
              project_id={selectedProjectId}
            />
          </PermissionAuth>
        </Box>
      );
    }
    return null;
  };

  // Dell Isilon Zone Sidebar - custom implementation matching ServiceNavigation style
  const renderZoneSidebar = () => {
    if (!isDellIsilon) return null;

    return (
      <Box 
        className="bg-white border-r border-gray-200"
        style={{ width: "228px", minHeight: "100%" }}
      >
        {/* Header */}
        <Box className="px-4 py-3 border-b border-gray-200">
          <Text className="text-sm font-semibold text-gray-700">Access Zones</Text>
        </Box>
        
        {/* Zone Links */}
        <Box className="flex flex-col">
          {selectedZonesWithDetails.map((zone) => {
            const isActive = zone.id === activeZoneId;
            const assignedWorkers = safeZoneWorkerAssignments[zone.id];
            const workerCount =
              (assignedWorkers?.nfs?.length || 0) + (assignedWorkers?.smb?.length || 0);

            // Build the label with protocol tags
            const protocolTags: string[] = [];
            if (zone.hasNfs) protocolTags.push("NFS");
            if (zone.hasSmb) protocolTags.push("SMB");
            const protocolLabel = protocolTags.length > 0 ? ` (${protocolTags.join(", ")})` : "";
            const workerLabel = workerCount > 0 ? ` [${workerCount}]` : "";

            return (
              <Box
                key={zone.id}
                onClick={() => setActiveZoneId(zone.id)}
                className={`px-4 py-3 cursor-pointer border-l-4 transition-colors ${
                  isActive
                    ? "bg-blue-50 border-l-blue-600 text-blue-700"
                    : "border-l-transparent hover:bg-gray-50 text-gray-700"
                }`}
              >
                <Text className={`text-sm ${isActive ? "font-semibold" : "font-medium"}`}>
                  {zone.name}{protocolLabel}{workerLabel}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  };

  // Dell Isilon layout with sidebar - uses ServiceNavigation and Layout components
  if (isDellIsilon) {
    const { pagination, rows: tableRows, sortState, toggleSort, filterState, updateFilterState, updateTextFilter } = dellIsilonTableState;
    
    return (
      <section style={{ display: "grid", gridTemplateColumns: "228px 1fr", height: "100%" }}>
        {renderZoneSidebar()}
        <Layout.Page>
          <Layout.Content>
            <Layout.Container style={{ height: "100%" }}>
              <WorkersWithErrorAccordion />
              {activeZone ? (
                <Box>
                  {/* Header with label, search, and refresh */}
                  <Box className="p-2 flex gap-4 justify-between">
                    <Box className="flex gap-2 items-center">
                      <Text className="text-[#404040] text-[16px] font-[590] leading-[28px]">
                        {activeZone.name} - {getProtocolSpecificLabel()}
                      </Text>
                      <Text className="text-[#404040] text-[16px] font-[590] leading-[28px]">
                        | {activeZoneSelectedWorkers.length} Associated
                      </Text>
                    </Box>
                    <Box className="flex gap-5 items-center">
                      <SearchWidget
                        setFilter={updateTextFilter}
                        className="w-[360px] mt-1"
                      />
                      <RefreshButton
                        isLoading={isFetching}
                        onRefresh={refetch}
                      />
                      {renderWorkerInstallationButton()}
                    </Box>
                  </Box>
                  
                  {/* Table */}
                  <Table
                    columns={dellIsilonTableState.columns}
                    rows={pagination?.pageRows || []}
                    sortState={sortState}
                    toggleSort={toggleSort}
                    filterState={filterState}
                    updateFilterState={updateFilterState}
                    isRowDisabled={checkDisabled}
                    isLoading={isFetching}
                    noDataLabel={
                      filteredWorkersList.length === 0 ? getNoWorkersMessage() : "No Data"
                    }
                  />
                  
                  {/* Pagination */}
                  {pagination?.pageRows && pagination.pageRows.length > 0 && (
                    <TablePager
                      pageRows={pagination.pageRows}
                      pageSize={10}
                      rows={tableRows || []}
                      pageIndex={pagination.pageIndex}
                      pageCount={pagination.pageCount}
                      gotoPage={pagination.gotoPage}
                    />
                  )}
                </Box>
              ) : (
                <Box className="flex items-center justify-center h-64 bg-gray-50 rounded-lg">
                  <Text className="text-gray-500">Select a zone from the sidebar to assign workers</Text>
                </Box>
              )}
            </Layout.Container>
          </Layout.Content>
        </Layout.Page>
      </section>
    );
  }

  // Default layout for Other NAS
  return (
    <Box className="m-auto w-9/12 h-[600px]">
      <WorkersWithErrorAccordion />

      <TableWrapper
        tableStateProps={safeWorkersListTableStateProps}
        isRowDisabled={checkDisabled}
        label={getProtocolSpecificLabel()}
        secondaryLabel={`| ${selectedWorkerIds.length} Associated`}
        refetchTableData={refetch}
        isRefreshing={isFetching}
        noDataLabel={
          safeWorkersListTableStateProps.rows.length === 0 ? getNoWorkersMessage() : "No Data"
        }
        content={renderWorkerInstallationButton()}
      />
    </Box>
  );
};

export default ValidateConnection;
