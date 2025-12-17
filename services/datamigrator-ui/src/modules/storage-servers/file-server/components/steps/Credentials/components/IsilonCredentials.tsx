import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { FormFieldInputNew, Text, Table, useTable, InlineLoader } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useContext, useMemo, useCallback, useEffect, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useFetchZonesMutation } from "@api/configApi";

// Type for zone data from API
interface ZoneData {
  id: string;
  name: string;
  ipList: Array<{ label: string; value: string }>;
}

const IsilonCredentials = () => {
  const {
    isJobRunning,
    selectedZoneIds,
    setSelectedZoneIds,
    zoneCredentials,
    setZoneCredentials,
    managementConsoleForm,
    certificateData,
  } = useContext(CommonFileServerContext);

  // State for zones fetched from API
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [zonesLoading, setZonesLoading] = useState<boolean>(false);
  const [zonesError, setZonesError] = useState<string | null>(null);

  // API mutation for fetching zones
  const [fetchZonesApi] = useFetchZonesMutation();

  // Ensure selectedZoneIds is always an array and zoneCredentials is always an object
  const safeSelectedZoneIds = selectedZoneIds || [];
  const safeZoneCredentials = zoneCredentials || {};

  console.debug("[IsilonCredentials] Render", {
    isJobRunning,
    selectedZoneIds: safeSelectedZoneIds,
    zoneCredentials: safeZoneCredentials,
    zones,
    zonesLoading,
    zonesError,
  });

  // Fetch zones from API when component mounts
  useEffect(() => {
    const fetchZones = async () => {
      const managementHost = managementConsoleForm?.formState?.managementHost;
      const username = managementConsoleForm?.formState?.managementUsername;
      const password = managementConsoleForm?.formState?.managementPassword;
      const certificate = certificateData?.certificatePEM;

      if (!managementHost || !username || !password || !certificate) {
        console.debug("[IsilonCredentials] Missing required data for zone fetch", {
          managementHost,
          username: !!username,
          password: !!password,
          certificate: !!certificate,
        });
        setZonesError("Missing management console credentials or certificate");
        return;
      }

      setZonesLoading(true);
      setZonesError(null);

      try {
        console.debug("[IsilonCredentials] Fetching zones from API...");
        const response = await fetchZonesApi({
          serverType: "Dell",
          host: managementHost,
          port: 8080,
          username,
          password,
          certificate,
        }).unwrap();

        console.debug("[IsilonCredentials] Zones API response:", response);

        // Transform API response to ZoneData format
        // Each zone has zoneName and ipAddresses[], we use the same IPs for both SMB and NFS
        const transformedZones: ZoneData[] = (response?.zones || []).map((zone: any) => ({
          id: zone.zoneName, // Use zoneName as ID
          name: zone.zoneName,
          ipList: (zone.ipAddresses || []).map((ip: string) => ({
            label: ip,
            value: ip,
          })),
        }));

        console.debug("[IsilonCredentials] Transformed zones:", transformedZones);
        setZones(transformedZones);
      } catch (error: any) {
        console.error("[IsilonCredentials] Error fetching zones:", error);
        const errorMessage = error?.data?.message || error?.message || "Failed to fetch zones from server";
        setZonesError(errorMessage);
      } finally {
        setZonesLoading(false);
      }
    };

    fetchZones();
  }, [managementConsoleForm?.formState, certificateData, fetchZonesApi]);

  // Helper for username/password
  const handleCredChange = useCallback((zoneId: string, field: string, value: string) => {
    console.debug(`[IsilonCredentials] handleCredChange zoneId=${zoneId} field=${field} value=${value}`);
    setZoneCredentials((prev: any) => ({
      ...prev,
      [zoneId]: {
        ...prev[zoneId],
        [field]: value,
      },
    }));
  }, [setZoneCredentials]);

  // Prepare rows data with IP lists for dropdowns
  const isilonTableRows = useMemo(
    () =>
      zones.map((zone) => ({
        ...zone,
        smbIpList: zone.ipList,
        nfsIpList: zone.ipList,
        smbIp: safeZoneCredentials[zone.id]?.smbIp || null,
        smbUsername: safeZoneCredentials[zone.id]?.smbUsername || "",
        smbPassword: safeZoneCredentials[zone.id]?.smbPassword || "",
        nfsIp: safeZoneCredentials[zone.id]?.nfsIp || null,
        nfsUsername: safeZoneCredentials[zone.id]?.nfsUsername || "",
        nfsPassword: safeZoneCredentials[zone.id]?.nfsPassword || "",
      })),
    [zones, safeZoneCredentials]
  );

  // Cell Renderer for Name column
  const NameCellRenderer = useCallback(({ row }: any) => {
    return <Text>{row?.name}</Text>;
  }, []);

  // Cell Renderer for SMB IP (dropdown)
  const SMBIPCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      return (
        <Autocomplete
          options={row.smbIpList}
          value={row.smbIp ? row.smbIpList.find((ip: any) => ip.value === row.smbIp) : null}
          onChange={(_e, newValue) => {
            setZoneCredentials((prev: any) => ({
              ...prev,
              [zoneId]: {
                ...prev[zoneId],
                smbIp: newValue ? newValue.value : "",
              },
            }));
          }}
          disabled={!isRowSelected || isJobRunning}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.value === value.value}
          renderInput={(params) => (
            <TextField {...params} label="SMB IP" placeholder="Select SMB IP" size="small" />
          )}
          size="small"
          fullWidth
        />
      );
    },
    [safeSelectedZoneIds, isJobRunning, setZoneCredentials]
  );

  // Cell Renderer for SMB Username
  const SMBUsernameCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      return (
        <FormFieldInputNew
          type="text"
          value={row?.smbUsername || ""}
          onChange={(e: any) => {
            handleCredChange(zoneId, "smbUsername", e.target.value);
          }}
          disabled={!isRowSelected || isJobRunning}
          placeholder="SMB Username"
          label=" "
          name={`smbUsername-${zoneId}`}
          className="w-full"
          onBlur={(e: any) => {
            handleCredChange(zoneId, "smbUsername", e.target.value.trim());
          }}
        />
      );
    },
    [safeSelectedZoneIds, isJobRunning, handleCredChange]
  );

  // Cell Renderer for SMB Password
  const SMBPasswordCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      return (
        <FormFieldInputNew
          type="password"
          value={row?.smbPassword || ""}
          onChange={(e: any) => {
            handleCredChange(zoneId, "smbPassword", e.target.value);
          }}
          disabled={!isRowSelected || isJobRunning}
          placeholder="SMB Password"
          label=" "
          name={`smbPassword-${zoneId}`}
          className="w-full"
          onBlur={(e: any) => {
            handleCredChange(zoneId, "smbPassword", e.target.value.trim());
          }}
        />
      );
    },
    [safeSelectedZoneIds, isJobRunning, handleCredChange]
  );

  // Cell Renderer for NFS IP (dropdown)
  const NFSIPCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      return (
        <Autocomplete
          options={row.nfsIpList}
          value={row.nfsIp ? row.nfsIpList.find((ip: any) => ip.value === row.nfsIp) : null}
          onChange={(_e, newValue) => {
            setZoneCredentials((prev: any) => ({
              ...prev,
              [zoneId]: {
                ...prev[zoneId],
                nfsIp: newValue ? newValue.value : "",
              },
            }));
          }}
          disabled={!isRowSelected || isJobRunning}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.value === value.value}
          renderInput={(params) => (
            <TextField {...params} label="NFS IP" placeholder="Select NFS IP" size="small" />
          )}
          size="small"
          fullWidth
        />
      );
    },
    [safeSelectedZoneIds, isJobRunning, setZoneCredentials]
  );

  // Cell Renderer for NFS Username
  const NFSUsernameCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      return (
        <FormFieldInputNew
          type="text"
          value={row?.nfsUsername || ""}
          onChange={(e: any) => {
            handleCredChange(zoneId, "nfsUsername", e.target.value);
          }}
          disabled={!isRowSelected || isJobRunning}
          placeholder="NFS Username"
          label=" "
          name={`nfsUsername-${zoneId}`}
          className="w-full"
          onBlur={(e: any) => {
            handleCredChange(zoneId, "nfsUsername", e.target.value.trim());
          }}
        />
      );
    },
    [safeSelectedZoneIds, isJobRunning, handleCredChange]
  );

  // Cell Renderer for NFS Password
  const NFSPasswordCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      return (
        <FormFieldInputNew
          type="password"
          value={row?.nfsPassword || ""}
          onChange={(e: any) => {
            handleCredChange(zoneId, "nfsPassword", e.target.value);
          }}
          disabled={!isRowSelected || isJobRunning}
          placeholder="NFS Password"
          label=" "
          name={`nfsPassword-${zoneId}`}
          className="w-full"
          onBlur={(e: any) => {
            handleCredChange(zoneId, "nfsPassword", e.target.value.trim());
          }}
        />
      );
    },
    [safeSelectedZoneIds, isJobRunning, handleCredChange]
  );

  // Column definitions with cell renderers
  const columnDefs: any[] = useMemo(
    () => [
      {
        id: 1,
        header: "Name",
        accessor: "name",
        Renderer: NameCellRenderer,
      },
      {
        id: 2,
        header: "SMB IP",
        accessor: "smbIp",
        Renderer: SMBIPCellRenderer,
        sort: { enabled: false },
      },
      {
        id: 3,
        header: "SMB Username",
        accessor: "smbUsername",
        Renderer: SMBUsernameCellRenderer,
        sort: { enabled: false },
      },
      {
        id: 4,
        header: "SMB Password",
        accessor: "smbPassword",
        Renderer: SMBPasswordCellRenderer,
        sort: { enabled: false },
      },
      {
        id: 5,
        header: "NFS IP",
        accessor: "nfsIp",
        Renderer: NFSIPCellRenderer,
        sort: { enabled: false },
      },
      {
        id: 6,
        header: "NFS Username",
        accessor: "nfsUsername",
        Renderer: NFSUsernameCellRenderer,
        sort: { enabled: false },
      },
      {
        id: 7,
        header: "NFS Password",
        accessor: "nfsPassword",
        Renderer: NFSPasswordCellRenderer,
        sort: { enabled: false },
      },
    ],
    [
      NameCellRenderer,
      SMBIPCellRenderer,
      SMBUsernameCellRenderer,
      SMBPasswordCellRenderer,
      NFSIPCellRenderer,
      NFSUsernameCellRenderer,
      NFSPasswordCellRenderer,
    ]
  );

  // Use the useTable hook with row selection
  const isilonTableState = useTable({
    columns: columnDefs,
    rows: isilonTableRows,
    isSorting: true,
    isRowSelecting: true,
    defaultSelectionState: {
      rows: {},
    },
    pageSize: 10,
  });

  const {
    pagination,
    columns,
    sortState,
    toggleSort,
    filterState,
    updateFilterState,
    toggleRowSelection,
    selectionState,
  } = isilonTableState;

  // Watch selection state changes and update selectedZoneIds
  useEffect(() => {
    const selectedZoneIdArray = Object.keys(selectionState.rows).filter(
      (key) => selectionState.rows[key] === true
    );
    console.debug("[IsilonCredentials] Selection changed", selectionState.rows, "selectedZoneIdArray", selectedZoneIdArray);
    setSelectedZoneIds(selectedZoneIdArray);
  }, [selectionState.rows, setSelectedZoneIds]);

  return (
    <Box className="mt-4 flex flex-col p-6 w-full">
      <Box className="!bg-white shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px] p-6">
        <Text className="text-base font-semibold mb-4">Access Zones</Text>
        <Text className="text-sm text-gray-600 mb-4">
          Select one or more zones and enter SMB/NFS credentials for each selected zone.
        </Text>
        
        <Box className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
          <InfoIcon className="text-blue-600 mt-0.5 flex-shrink-0" size="16" />
          <Text className="text-sm text-blue-800">
            For each selected zone, you can configure NFS credentials, SMB credentials, or both. 
            Only protocols with complete credentials (IP, username, and password) will be available for migration jobs.
          </Text>
        </Box>

        {zonesLoading ? (
          // Loading state
          <Box className="flex flex-col items-center justify-center py-8">
            <InlineLoader />
            <Text className="mt-4 text-gray-600">Loading access zones...</Text>
          </Box>
        ) : zonesError ? (
          // Error state
          <Box className="flex flex-col items-center justify-center py-8 text-center">
            <Box className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-md max-w-md">
              <InfoIcon className="text-red-600 mt-0.5 flex-shrink-0" size="16" />
              <Text className="text-sm text-red-800">{zonesError}</Text>
            </Box>
          </Box>
        ) : zones.length === 0 ? (
          // Empty state
          <Box className="flex flex-col items-center justify-center py-8 text-center">
            <Text className="text-gray-600">No access zones found.</Text>
            <Text className="text-sm text-gray-500 mt-2">
              Please verify your management console connection and try again.
            </Text>
          </Box>
        ) : (
          // Table with zones
          <Table
            columns={columns}
            rows={pagination?.pageRows}
            sortState={sortState}
            toggleSort={toggleSort}
            filterState={filterState}
            updateFilterState={updateFilterState}
            toggleRowSelection={toggleRowSelection}
            selectionState={selectionState}
          />
        )}
      </Box>
    </Box>
  );
};

export default IsilonCredentials;
