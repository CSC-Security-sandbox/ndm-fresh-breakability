import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { FormFieldInputNew, Text, RadioButton, Table, useTable } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useContext, useMemo, useCallback, useEffect } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import NFSCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/NFSCredentials";
import SMBCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/SMBCredentials";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";

// Hardcoded Dell Isilon zones
const DELL_ISILON_ZONES = [
  { id: "zone1", name: "Zone1" },
  { id: "zone2", name: "Zone2" },
];

// Example IP lists for demo (replace with real data from API)
const SMB_IP_LIST = [
  { label: "10.0.0.1", value: "10.0.0.1" },
  { label: "10.0.0.2", value: "10.0.0.2" },
];
const NFS_IP_LIST = [
  { label: "192.168.1.1", value: "192.168.1.1" },
  { label: "192.168.1.2", value: "192.168.1.2" },
];

const Credentials = () => {
  const {
    hostCredentialsForm,
    isJobRunning,
    selectedProtocol,
    setSelectedProtocol,
    serverTypeForm,
    selectedZoneIds,
    setSelectedZoneIds,
    zoneCredentials,
    setZoneCredentials,
  } = useContext(CommonFileServerContext);

  // Ensure selectedZoneIds is always an array and zoneCredentials is always an object
  const safeSelectedZoneIds = selectedZoneIds || [];
  const safeZoneCredentials = zoneCredentials || {};

  console.debug("[Credentials] Render", {
    hostCredentialsForm,
    isJobRunning,
    selectedProtocol,
    serverTypeForm,
    selectedZoneIds: safeSelectedZoneIds,
    zoneCredentials: safeZoneCredentials,
  });

  const selectedServerType = serverTypeForm?.formState?.serverType?.value;
  const isDellIsilon = selectedServerType === "dell";
  console.debug("[Credentials] selectedServerType", selectedServerType, "isDellIsilon", isDellIsilon);

  // Helper for username/password
  const handleCredChange = (zoneId: string, field: string, value: string) => {
    console.debug(`[Credentials] handleCredChange zoneId=${zoneId} field=${field} value=${value}`);
    setZoneCredentials((prev: any) => ({
      ...prev,
      [zoneId]: {
        ...prev[zoneId],
        [field]: value,
      },
    }));
  };

  // Prepare rows data with IP lists for dropdowns
  const isilonTableRows = useMemo(
    () =>
      DELL_ISILON_ZONES.map((zone) => ({
        ...zone,
        smbIpList: SMB_IP_LIST,
        nfsIpList: NFS_IP_LIST,
        smbIp: safeZoneCredentials[zone.id]?.smbIp || null,
        smbUsername: safeZoneCredentials[zone.id]?.smbUsername || "",
        smbPassword: safeZoneCredentials[zone.id]?.smbPassword || "",
        nfsIp: safeZoneCredentials[zone.id]?.nfsIp || null,
        nfsUsername: safeZoneCredentials[zone.id]?.nfsUsername || "",
        nfsPassword: safeZoneCredentials[zone.id]?.nfsPassword || "",
      })),
    [safeZoneCredentials]
  );
  console.debug("[Credentials] isilonTableRows", isilonTableRows);

  // Cell Renderer for Name column
  const NameCellRenderer = useCallback(({ row }: any) => {
    console.debug("[Credentials] NameCellRenderer", row);
    return <Text>{row?.name}</Text>;
  }, []);

  // Cell Renderer for SMB IP (dropdown, MUI Autocomplete like Destination in bulk migrate)
  const SMBIPCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      console.debug("[Credentials] SMBIPCellRenderer", { row, isRowSelected });
      return (
        <Autocomplete
          options={row.smbIpList}
          value={row.smbIp ? row.smbIpList.find((ip: any) => ip.value === row.smbIp) : null}
          onChange={(_e, newValue) => {
            console.debug("[Credentials] SMBIPCellRenderer onChange", { zoneId, newValue });
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
      console.debug("[Credentials] SMBUsernameCellRenderer", { row, isRowSelected });
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
    [safeSelectedZoneIds, isJobRunning]
  );

  // Cell Renderer for SMB Password
  const SMBPasswordCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      console.debug("[Credentials] SMBPasswordCellRenderer", { row, isRowSelected });
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
    [safeSelectedZoneIds, isJobRunning]
  );

  // Cell Renderer for NFS IP (dropdown, MUI Autocomplete like Destination in bulk migrate)
  const NFSIPCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      console.debug("[Credentials] NFSIPCellRenderer", { row, isRowSelected });
      return (
        <Autocomplete
          options={row.nfsIpList}
          value={row.nfsIp ? row.nfsIpList.find((ip: any) => ip.value === row.nfsIp) : null}
          onChange={(_e, newValue) => {
            console.debug("[Credentials] NFSIPCellRenderer onChange", { zoneId, newValue });
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
      console.debug("[Credentials] NFSUsernameCellRenderer", { row, isRowSelected });
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
    [safeSelectedZoneIds, isJobRunning]
  );

  // Cell Renderer for NFS Password
  const NFSPasswordCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      const isRowSelected = safeSelectedZoneIds.includes(zoneId);
      console.debug("[Credentials] NFSPasswordCellRenderer", { row, isRowSelected });
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
    [safeSelectedZoneIds, isJobRunning]
  );

  // Column definitions with cell renderers (following BULK_MIGRATION_MOUNT_PATH_COL_DEFS pattern)
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
    [NameCellRenderer, SMBIPCellRenderer, SMBUsernameCellRenderer, SMBPasswordCellRenderer, NFSIPCellRenderer, NFSUsernameCellRenderer, NFSPasswordCellRenderer]
  );

  // Use the useTable hook following bulk migrate pattern with row selection
  const isilonTableState = useTable({
    columns: columnDefs,
    rows: isilonTableRows,
    isSorting: true,
    isRowSelecting: true, // Enable row selection like bulk migrate
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
    console.debug("[Credentials] useEffect selectionState.rows", selectionState.rows, "selectedZoneIdArray", selectedZoneIdArray);
    setSelectedZoneIds(selectedZoneIdArray);
  }, [selectionState.rows]);

  return (
    <>
      {console.debug("[Credentials] render return", { isDellIsilon, selectedZoneIds: safeSelectedZoneIds, zoneCredentials: safeZoneCredentials })}
      {!isDellIsilon && (
        <FormFrame>
          <Box className="mt-4 flex flex-col p-6 w-3/6">
            <FormFieldInputNew
              form={hostCredentialsForm}
              name="host"
              disabled={isJobRunning}
              placeholder="Host Name"
              label="Host Name"
              onBlur={(e: any) => {
                hostCredentialsForm.resetForm({
                  ...hostCredentialsForm?.formState,
                  host: e.target.value.trim(),
                });
              }}
            />
          </Box>
        </FormFrame>
      )}

      {isDellIsilon ? (
        // Dell Isilon: Show Access Zones table (full width like ExportPathsTable)
        <Box className="mt-4 flex flex-col p-6 w-full">
          <Box className="!bg-white shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px] p-6">
            <Text className="text-base font-semibold mb-4">Access Zones</Text>
            <Text className="text-sm text-gray-600 mb-4">
              Select one or more zones and enter SMB/NFS credentials for each selected zone.
            </Text>

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
          </Box>
        </Box>
      ) : (
        // Other NAS: Show Protocol Selection and NFS/SMB credentials
        <>
          <FormFrame>
            <Box className="mt-4 flex flex-col p-6">
              <Text className="text-base font-semibold mb-4">Protocol Selection</Text>
              <Box className="flex gap-4 mb-4">
                <RadioButton
                  checked={selectedProtocol === 'NFS'}
                  onChange={() => setSelectedProtocol('NFS')}
                  disabled={isJobRunning}
                  name="protocol"
                  value="NFS"
                >
                  NFS
                </RadioButton>
                <RadioButton
                  checked={selectedProtocol === 'SMB'}
                  onChange={() => setSelectedProtocol('SMB')}
                  disabled={isJobRunning}
                  name="protocol"
                  value="SMB"
                >
                  SMB
                </RadioButton>
              </Box>
              <Box className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <InfoIcon className="text-blue-600 mt-0.5 flex-shrink-0" size="16" />
                <Text className="text-sm text-blue-800">
                  If your file server supports both NFS and SMB, set up two distinct file servers—one using NFS and another using SMB.
                </Text>
              </Box>
            </Box>
          </FormFrame>

          <NFSCredentials />
          <SMBCredentials />
        </>
      )}
    </>
  );
};

export default Credentials;

