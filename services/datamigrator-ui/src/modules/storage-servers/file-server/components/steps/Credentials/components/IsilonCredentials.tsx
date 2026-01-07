import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { FormFieldInputNew, Text, Table, useTable, InlineLoader } from "@netapp/bxp-design-system-react";
import { InfoIcon, NoticeTriangleIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useContext, useMemo, useCallback, useEffect, useState, useRef } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useFetchZonesMutation } from "@api/configApi";

// Type for zone data from API
interface ZoneData {
  id: string;
  numericId: number;
  name: string;
  ipList: Array<{ label: string; value: string }>;
  smartConnectSsip?: string;     // SSIP from Isilon API for DNS resolution
  smartConnectDnsZone?: string;  // DNS zone from Isilon API for resolver config
}

// Extended type for Edit mode with configuration flags
interface EditModeZoneData extends ZoneData {
  isConfiguredZone?: boolean;
  hasConfiguredNfs?: boolean;
  hasConfiguredSmb?: boolean;
}

// ============================================================================
// ADD MODE TABLE COMPONENT - Completely independent implementation
// ============================================================================
interface AddModeTableProps {
  zones: ZoneData[];
  isJobRunning: boolean;
  selectedZoneIds: string[];
  setSelectedZoneIds: (ids: any) => void;
  zoneCredentials: any;
  setZoneCredentials: (creds: any) => void;
}

const AddModeTable = ({
  zones,
  isJobRunning,
  selectedZoneIds,
  setSelectedZoneIds,
  zoneCredentials,
  setZoneCredentials,
}: AddModeTableProps) => {
  const safeSelectedZoneIds = selectedZoneIds || [];
  const safeZoneCredentials = zoneCredentials || {};

  // Helper for username/password changes
  const handleCredChange = useCallback((zoneId: string, field: string, value: string) => {
    console.debug(`[AddModeTable] handleCredChange zoneId=${zoneId} field=${field} value=${value}`);
    setZoneCredentials((prev: any) => ({
      ...prev,
      [zoneId]: {
        ...prev[zoneId],
        [field]: value,
      },
    }));
  }, [setZoneCredentials]);

  // Prepare rows data
  const tableRows = useMemo(
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

  // Column definitions
  const columnDefs: any[] = useMemo(
    () => [
      { id: 1, header: "Name", accessor: "name", Renderer: NameCellRenderer },
      { id: 2, header: "SMB IP", accessor: "smbIp", Renderer: SMBIPCellRenderer, sort: { enabled: false } },
      { id: 3, header: "SMB Username", accessor: "smbUsername", Renderer: SMBUsernameCellRenderer, sort: { enabled: false } },
      { id: 4, header: "SMB Password", accessor: "smbPassword", Renderer: SMBPasswordCellRenderer, sort: { enabled: false } },
      { id: 5, header: "NFS IP", accessor: "nfsIp", Renderer: NFSIPCellRenderer, sort: { enabled: false } },
      { id: 6, header: "NFS Username", accessor: "nfsUsername", Renderer: NFSUsernameCellRenderer, sort: { enabled: false } },
      { id: 7, header: "NFS Password", accessor: "nfsPassword", Renderer: NFSPasswordCellRenderer, sort: { enabled: false } },
    ],
    [NameCellRenderer, SMBIPCellRenderer, SMBUsernameCellRenderer, SMBPasswordCellRenderer, NFSIPCellRenderer, NFSUsernameCellRenderer, NFSPasswordCellRenderer]
  );

  // useTable hook - Add mode uses simple empty default selection
  const tableState = useTable({
    columns: columnDefs,
    rows: tableRows,
    isSorting: true,
    isRowSelecting: true,
    defaultSelectionState: { rows: {} },
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
  } = tableState;

  // Watch selection state and update context
  useEffect(() => {
    const selectedZoneIdArray = Object.keys(selectionState.rows).filter(
      (key) => selectionState.rows[key] === true
    );
    console.debug("[AddModeTable] Selection changed", selectionState.rows, "selectedZoneIdArray", selectedZoneIdArray);
    setSelectedZoneIds(selectedZoneIdArray);

    // Store numeric zone IDs and SmartConnect info in zoneCredentials
    selectedZoneIdArray.forEach((zoneId) => {
      const zone = zones.find((z) => z.id === zoneId);
      if (zone && zone.numericId !== undefined) {
        setZoneCredentials((prev: any) => ({
          ...prev,
          [zoneId]: {
            ...prev[zoneId],
            numericZoneId: zone.numericId,
            smartConnectSsip: zone.smartConnectSsip,       // SSIP for DNS resolution
            smartConnectDnsZone: zone.smartConnectDnsZone, // DNS zone for resolver config
          },
        }));
      }
    });
  }, [selectionState.rows, setSelectedZoneIds, zones, setZoneCredentials]);

  return (
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
  );
};

// ============================================================================
// EDIT MODE INPUT COMPONENTS - Manage local state to prevent focus loss
// ============================================================================

interface EditModeInputProps {
  zoneId: string;
  field: string;
  type: "text" | "password";
  placeholder: string;
  initialValue: string;
  disabled: boolean;
  error?: string;
  onValueChange: (zoneId: string, field: string, value: string) => void;
}

const EditModeInput = ({ zoneId, field, type, placeholder, initialValue, disabled, error, onValueChange }: EditModeInputProps) => {
  const [localValue, setLocalValue] = useState(initialValue);
  
  // Sync with external value only on mount or when zoneId changes
  useEffect(() => {
    setLocalValue(initialValue);
  }, [zoneId]); // Only re-sync when zone changes, not when initialValue changes

  return (
    <FormFieldInputNew
      type={type}
      value={localValue}
      onChange={(e: any) => {
        const newValue = e.target.value;
        setLocalValue(newValue);
        onValueChange(zoneId, field, newValue);
      }}
      disabled={disabled}
      placeholder={placeholder}
      label=" "
      name={`${field}-${zoneId}`}
      className="w-full"
      error={error}
      onBlur={(e: any) => {
        const trimmed = e.target.value.trim();
        setLocalValue(trimmed);
        onValueChange(zoneId, field, trimmed);
      }}
    />
  );
};

// ============================================================================
// EDIT MODE AUTOCOMPLETE COMPONENT - Manage local state to prevent value loss on blur
// ============================================================================

interface EditModeAutocompleteProps {
  zoneId: string;
  field: "smbIp" | "nfsIp";
  label: string;
  placeholder: string;
  options: Array<{ label: string; value: string }>;
  initialValue: string | null;
  disabled: boolean;
  disableClearable: boolean;
  onValueChange: (zoneId: string, field: string, value: string) => void;
}

const EditModeAutocomplete = ({
  zoneId,
  field,
  label,
  placeholder,
  options,
  initialValue,
  disabled,
  disableClearable,
  onValueChange,
}: EditModeAutocompleteProps) => {
  // Use local state to manage the selected value
  const [localValue, setLocalValue] = useState<string | null>(initialValue);

  // Sync with external value only on mount or when zoneId changes
  useEffect(() => {
    setLocalValue(initialValue);
  }, [zoneId]); // Only re-sync when zone changes

  const selectedOption = localValue ? options.find((ip) => ip.value === localValue) : null;

  const handleChange = (_e: any, newValue: any) => {
    console.debug(`[EditModeAutocomplete] ${field} onChange - zoneId=${zoneId}`, { newValue, localValue });
    
    // If disableClearable is true and newValue is null, don't allow clearing
    if (disableClearable && !newValue) {
      console.debug(`[EditModeAutocomplete] Blocked clearing ${field} for configured protocol`);
      return;
    }
    
    const newIpValue = newValue ? newValue.value : "";
    setLocalValue(newIpValue || null);
    onValueChange(zoneId, field, newIpValue);
  };

  return (
    <Autocomplete
      options={options}
      value={selectedOption || null}
      onChange={handleChange}
      disabled={disabled}
      disableClearable={disableClearable}
      getOptionLabel={(option) => option?.label || ""}
      isOptionEqualToValue={(option, value) => option?.value === value?.value}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          size="small"
        />
      )}
      size="small"
      fullWidth
    />
  );
};

// ============================================================================
// EDIT MODE TABLE COMPONENT - Completely independent implementation
// ============================================================================
interface EditModeTableProps {
  zones: EditModeZoneData[];
  isJobRunning: boolean;
  selectedZoneIds: string[];
  setSelectedZoneIds: (ids: any) => void;
  zoneCredentials: any;
  setZoneCredentials: (creds: any) => void;
  originalConfiguredZones: Map<string, { hasNfs: boolean; hasSmb: boolean }>;
}

const EditModeTable = ({
  zones,
  isJobRunning,
  selectedZoneIds,
  setSelectedZoneIds,
  zoneCredentials,
  setZoneCredentials,
  originalConfiguredZones,
}: EditModeTableProps) => {
  // Debug: Log when component mounts/renders with detailed credential info
  console.debug("[EditModeTable] Component render", {
    zonesCount: zones.length,
    zoneIds: zones.map(z => z.id),
    originalConfiguredZonesKeys: Array.from(originalConfiguredZones.keys()),
    selectedZoneIds,
    zoneCredentialsKeys: Object.keys(zoneCredentials || {}),
    zoneCredentialsSummary: Object.entries(zoneCredentials || {}).map(([zoneId, creds]: [string, any]) => ({
      zoneId,
      hasNfs: !!(creds?.nfsIp && creds?.nfsUsername && creds?.nfsPassword),
      hasSmb: !!(creds?.smbIp && creds?.smbUsername && creds?.smbPassword),
      nfsIp: creds?.nfsIp || '(empty)',
      smbIp: creds?.smbIp || '(empty)',
    })),
  });

  const safeSelectedZoneIds = selectedZoneIds || [];
  const safeZoneCredentials = zoneCredentials || {};

  // Use refs to access latest values without causing cell renderer re-creation
  // This prevents focus loss when typing in input fields
  const zoneCredentialsRef = useRef(safeZoneCredentials);
  zoneCredentialsRef.current = safeZoneCredentials;

  const selectedZoneIdsRef = useRef(safeSelectedZoneIds);
  selectedZoneIdsRef.current = safeSelectedZoneIds;

  // Track selection state from the table directly - this updates synchronously on checkbox click
  // Unlike selectedZoneIds which updates asynchronously through useEffect
  const selectionStateRef = useRef<Record<string, boolean>>({});

  // Check if a zone is originally configured (can't be deselected)
  const isZoneConfigured = useCallback((zoneId: string) => {
    return originalConfiguredZones.has(zoneId);
  }, [originalConfiguredZones]);

  // Check if a protocol is originally configured for a zone (IP can't be empty)
  const isProtocolConfigured = useCallback((zoneId: string, protocol: 'nfs' | 'smb') => {
    const config = originalConfiguredZones.get(zoneId);
    if (!config) return false;
    return protocol === 'nfs' ? config.hasNfs : config.hasSmb;
  }, [originalConfiguredZones]);

  // Helper for username/password changes
  const handleCredChange = useCallback((zoneId: string, field: string, value: string) => {
    console.debug(`[EditModeTable] handleCredChange CALLED - zoneId=${zoneId} field=${field} value=${field.includes('Password') ? '(hidden)' : value}`);
    setZoneCredentials((prev: any) => {
      const prevZoneData = prev[zoneId] || {};
      const updated = {
        ...prev,
        [zoneId]: {
          ...prevZoneData,
          [field]: value,
        },
      };
      console.debug(`[EditModeTable] handleCredChange - zone "${zoneId}" BEFORE:`, {
        nfsIp: prevZoneData.nfsIp,
        nfsUsername: prevZoneData.nfsUsername,
        nfsPassword: prevZoneData.nfsPassword ? '(set)' : '(empty)',
        smbIp: prevZoneData.smbIp,
        smbUsername: prevZoneData.smbUsername,
        smbPassword: prevZoneData.smbPassword ? '(set)' : '(empty)',
      });
      console.debug(`[EditModeTable] handleCredChange - zone "${zoneId}" AFTER:`, {
        nfsIp: updated[zoneId].nfsIp,
        nfsUsername: updated[zoneId].nfsUsername,
        nfsPassword: updated[zoneId].nfsPassword ? '(set)' : '(empty)',
        smbIp: updated[zoneId].smbIp,
        smbUsername: updated[zoneId].smbUsername,
        smbPassword: updated[zoneId].smbPassword ? '(set)' : '(empty)',
      });
      return updated;
    });
  }, [setZoneCredentials]);

  // Prepare rows data with isSelectionDisabled flag for configured zones
  // IMPORTANT: Do NOT include credential values here - they cause re-renders when typing
  // Cell renderers read from zoneCredentialsRef instead
  const tableRows = useMemo(
    () =>
      zones.map((zone) => {
        return {
          ...zone,
          smbIpList: zone.ipList,
          nfsIpList: zone.ipList,
          // Credential values intentionally NOT included - read from ref in cell renderers
        };
      }),
    [zones]
  );

  // Cell Renderer for Name column - shows configured badge
  const NameCellRenderer = useCallback(({ row }: any) => {
    const isConfigured = isZoneConfigured(row?.id);
    return (
      <Box className="flex items-center gap-2">
        <Text>{row?.name}</Text>
        {/* {isConfigured && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
            Configured
          </span>
        )} */}
      </Box>
    );
  }, [isZoneConfigured]);

  // Cell Renderer for SMB IP (dropdown) - Uses EditModeAutocomplete to prevent value loss on blur
  const SMBIPCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      // Read from selectionStateRef to check if row is selected (updates synchronously with checkbox)
      const isRowSelected = selectionStateRef.current[zoneId] === true;
      const isSmbConfigured = isProtocolConfigured(zoneId, 'smb');
      const currentSmbIp = zoneCredentialsRef.current[zoneId]?.smbIp || null;

      console.debug(`[EditModeTable] SMBIPCellRenderer render - zoneId=${zoneId}`, {
        isRowSelected,
        isSmbConfigured,
        currentSmbIp,
        disabled: !isRowSelected || isJobRunning,
      });

      return (
        <EditModeAutocomplete
          zoneId={zoneId}
          field="smbIp"
          label="SMB IP"
          placeholder="Select SMB IP"
          options={row.smbIpList || []}
          initialValue={currentSmbIp}
          disabled={!isRowSelected || isJobRunning}
          disableClearable={isSmbConfigured}
          onValueChange={handleCredChange}
        />
      );
    },
    [isJobRunning, isProtocolConfigured, handleCredChange]
  );

  // Cell Renderer for SMB Username - Uses EditModeInput component to prevent focus loss
  const SMBUsernameCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      // Read from selectionStateRef to check if row is selected (updates synchronously with checkbox)
      const isRowSelected = selectionStateRef.current[zoneId] === true;
      const initialValue = zoneCredentialsRef.current[zoneId]?.smbUsername || "";
      const currentSmbIp = zoneCredentialsRef.current[zoneId]?.smbIp;
      const hasIpButNoUsername = !!(currentSmbIp && !initialValue?.trim());

      return (
        <EditModeInput
          zoneId={zoneId}
          field="smbUsername"
          type="text"
          placeholder="SMB Username"
          initialValue={initialValue}
          disabled={!isRowSelected || isJobRunning}
          error={hasIpButNoUsername ? "Required when IP is selected" : undefined}
          onValueChange={handleCredChange}
        />
      );
    },
    [isJobRunning, handleCredChange]
  );

  // Cell Renderer for SMB Password - Uses EditModeInput component to prevent focus loss
  const SMBPasswordCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      // Read from selectionStateRef to check if row is selected (updates synchronously with checkbox)
      const isRowSelected = selectionStateRef.current[zoneId] === true;
      const initialValue = zoneCredentialsRef.current[zoneId]?.smbPassword || "";
      const currentSmbIp = zoneCredentialsRef.current[zoneId]?.smbIp;
      const hasIpButNoPassword = !!(currentSmbIp && !initialValue?.trim());

      return (
        <EditModeInput
          zoneId={zoneId}
          field="smbPassword"
          type="password"
          placeholder="SMB Password"
          initialValue={initialValue}
          disabled={!isRowSelected || isJobRunning}
          error={hasIpButNoPassword ? "Required when IP is selected" : undefined}
          onValueChange={handleCredChange}
        />
      );
    },
    [isJobRunning, handleCredChange]
  );

  // Cell Renderer for NFS IP (dropdown) - Uses EditModeAutocomplete to prevent value loss on blur
  const NFSIPCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      // Read from selectionStateRef to check if row is selected (updates synchronously with checkbox)
      const isRowSelected = selectionStateRef.current[zoneId] === true;
      const isNfsConfigured = isProtocolConfigured(zoneId, 'nfs');
      const currentNfsIp = zoneCredentialsRef.current[zoneId]?.nfsIp || null;

      console.debug(`[EditModeTable] NFSIPCellRenderer render - zoneId=${zoneId}`, {
        isRowSelected,
        isNfsConfigured,
        currentNfsIp,
        disabled: !isRowSelected || isJobRunning,
      });

      return (
        <EditModeAutocomplete
          zoneId={zoneId}
          field="nfsIp"
          label="NFS IP"
          placeholder="Select NFS IP"
          options={row.nfsIpList || []}
          initialValue={currentNfsIp}
          disabled={!isRowSelected || isJobRunning}
          disableClearable={isNfsConfigured}
          onValueChange={handleCredChange}
        />
      );
    },
    [isJobRunning, isProtocolConfigured, handleCredChange]
  );

  // Cell Renderer for NFS Username - Uses EditModeInput component to prevent focus loss
  const NFSUsernameCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      // Read from selectionStateRef to check if row is selected (updates synchronously with checkbox)
      const isRowSelected = selectionStateRef.current[zoneId] === true;
      const initialValue = zoneCredentialsRef.current[zoneId]?.nfsUsername || "";
      const currentNfsIp = zoneCredentialsRef.current[zoneId]?.nfsIp;
      const hasIpButNoUsername = !!(currentNfsIp && !initialValue?.trim());

      return (
        <EditModeInput
          zoneId={zoneId}
          field="nfsUsername"
          type="text"
          placeholder="NFS Username"
          initialValue={initialValue}
          disabled={!isRowSelected || isJobRunning}
          error={hasIpButNoUsername ? "Required when IP is selected" : undefined}
          onValueChange={handleCredChange}
        />
      );
    },
    [isJobRunning, handleCredChange]
  );

  // Cell Renderer for NFS Password - Uses EditModeInput component to prevent focus loss
  const NFSPasswordCellRenderer = useCallback(
    ({ row }: any) => {
      const zoneId = row?.id;
      // Read from selectionStateRef to check if row is selected (updates synchronously with checkbox)
      const isRowSelected = selectionStateRef.current[zoneId] === true;
      const initialValue = zoneCredentialsRef.current[zoneId]?.nfsPassword || "";
      const currentNfsIp = zoneCredentialsRef.current[zoneId]?.nfsIp;
      const hasIpButNoPassword = !!(currentNfsIp && !initialValue?.trim());

      return (
        <EditModeInput
          zoneId={zoneId}
          field="nfsPassword"
          type="password"
          placeholder="NFS Password"
          initialValue={initialValue}
          disabled={!isRowSelected || isJobRunning}
          error={hasIpButNoPassword ? "Required when IP is selected" : undefined}
          onValueChange={handleCredChange}
        />
      );
    },
    [isJobRunning, handleCredChange]
  );

  // Column definitions
  const columnDefs: any[] = useMemo(
    () => [
      { id: 1, header: "Name", accessor: "name", Renderer: NameCellRenderer },
      { id: 2, header: "SMB IP", accessor: "smbIp", Renderer: SMBIPCellRenderer, sort: { enabled: false } },
      { id: 3, header: "SMB Username", accessor: "smbUsername", Renderer: SMBUsernameCellRenderer, sort: { enabled: false } },
      { id: 4, header: "SMB Password", accessor: "smbPassword", Renderer: SMBPasswordCellRenderer, sort: { enabled: false } },
      { id: 5, header: "NFS IP", accessor: "nfsIp", Renderer: NFSIPCellRenderer, sort: { enabled: false } },
      { id: 6, header: "NFS Username", accessor: "nfsUsername", Renderer: NFSUsernameCellRenderer, sort: { enabled: false } },
      { id: 7, header: "NFS Password", accessor: "nfsPassword", Renderer: NFSPasswordCellRenderer, sort: { enabled: false } },
    ],
    [NameCellRenderer, SMBIPCellRenderer, SMBUsernameCellRenderer, SMBPasswordCellRenderer, NFSIPCellRenderer, NFSUsernameCellRenderer, NFSPasswordCellRenderer]
  );

  // Build default selection state - configured zones should be pre-selected
  // Include ALL zones in the selection state, with configured ones set to true
  const defaultSelectionState = useMemo(() => {
    const rows: Record<string, boolean> = {};
    // Initialize all zones as unselected
    zones.forEach((zone) => {
      rows[zone.id] = false;
    });
    // Then set configured zones as selected
    originalConfiguredZones.forEach((_, zoneId) => {
      rows[zoneId] = true;
    });
    console.debug("[EditModeTable] defaultSelectionState computed", { 
      zonesCount: zones.length, 
      configuredCount: originalConfiguredZones.size,
      rows 
    });
    return { rows };
  }, [zones, originalConfiguredZones]);

  // useTable hook
  const tableState = useTable({
    columns: columnDefs,
    rows: tableRows,
    isSorting: true,
    isRowSelecting: true,
    defaultSelectionState,
    pageSize: 10,
  });

  const {
    pagination,
    columns,
    sortState,
    toggleSort,
    filterState,
    updateFilterState,
    toggleRowSelection: originalToggleRowSelection,
    selectionState,
  } = tableState;

  // Update selectionStateRef synchronously with the table's selection state
  // This allows cell renderers to check if a row is selected without waiting for useEffect
  selectionStateRef.current = selectionState.rows;

  // Debug: Log the selection state from useTable
  console.debug("[EditModeTable] useTable selectionState", {
    selectionStateRows: selectionState.rows,
    defaultSelectionStateRows: defaultSelectionState.rows,
  });

  // Custom toggle function that prevents deselecting configured zones
  // Must return a function to match the curried signature: (id) => (value) => void
  const customToggleRowSelection = useCallback((rowId: string) => {
    return (value: any) => {
      const isConfigured = isZoneConfigured(rowId);
      const isCurrentlySelected = selectionState.rows[rowId] === true;
      
      console.debug("[EditModeTable] customToggleRowSelection called", {
        rowId,
        value,
        isConfigured,
        isCurrentlySelected,
      });
      
      // If trying to deselect a configured zone, block it
      if (isConfigured && isCurrentlySelected && !value) {
        console.debug("[EditModeTable] Blocked deselection of configured zone:", rowId);
        return; // Block deselection
      }
      
      // Allow all other actions
      originalToggleRowSelection(rowId)(value);
    };
  }, [isZoneConfigured, selectionState.rows, originalToggleRowSelection]);

  // Watch selection state and update context
  useEffect(() => {
    const selectedZoneIdArray = Object.keys(selectionState.rows).filter(
      (key) => selectionState.rows[key] === true
    );
    console.debug("[EditModeTable] Selection changed", selectionState.rows, "selectedZoneIdArray", selectedZoneIdArray);
    setSelectedZoneIds(selectedZoneIdArray);

    // Store numeric zone IDs and SmartConnect info in zoneCredentials
    selectedZoneIdArray.forEach((zoneId) => {
      const zone = zones.find((z) => z.id === zoneId);
      if (zone && zone.numericId !== undefined) {
        setZoneCredentials((prev: any) => ({
          ...prev,
          [zoneId]: {
            ...prev[zoneId],
            numericZoneId: zone.numericId,
            smartConnectSsip: zone.smartConnectSsip,       // SSIP for DNS resolution
            smartConnectDnsZone: zone.smartConnectDnsZone, // DNS zone for resolver config
          },
        }));
      }
    });
  }, [selectionState.rows, setSelectedZoneIds, zones, setZoneCredentials]);

  return (
    <Table
      columns={columns}
      rows={pagination?.pageRows}
      sortState={sortState}
      toggleSort={toggleSort}
      filterState={filterState}
      updateFilterState={updateFilterState}
      toggleRowSelection={customToggleRowSelection}
      selectionState={selectionState}
    />
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const IsilonCredentials = () => {
  const {
    isJobRunning,
    selectedZoneIds,
    setSelectedZoneIds,
    zoneCredentials,
    setZoneCredentials,
    managementConsoleForm,
    certificateData,
    isEditMode,
    editingFileServerDetails,
  } = useContext(CommonFileServerContext);

  // State for zones fetched from API
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [zonesLoading, setZonesLoading] = useState<boolean>(false);
  const [zonesError, setZonesError] = useState<string | null>(null);

  // API mutation for fetching zones
  const [fetchZonesApi] = useFetchZonesMutation();

  // Edit mode: Track originally configured zones and their protocols
  const originalConfiguredZones = useMemo(() => {
    if (!isEditMode || !editingFileServerDetails?.fileServers) {
      return new Map<string, { hasNfs: boolean; hasSmb: boolean }>();
    }

    const configMap = new Map<string, { hasNfs: boolean; hasSmb: boolean }>();
    editingFileServerDetails.fileServers.forEach((fs: any) => {
      const zoneName = fs.fileServerName || "";
      if (!configMap.has(zoneName)) {
        configMap.set(zoneName, { hasNfs: false, hasSmb: false });
      }
      const zoneConfig = configMap.get(zoneName)!;
      if (fs.protocol === "NFS") {
        zoneConfig.hasNfs = true;
      } else if (fs.protocol === "SMB") {
        zoneConfig.hasSmb = true;
      }
    });
    return configMap;
  }, [isEditMode, editingFileServerDetails]);

  console.debug("[IsilonCredentials] Render", {
    isJobRunning,
    isEditMode,
    selectedZoneIds,
    zoneCredentials,
    zones,
    zonesLoading,
    zonesError,
    originalConfiguredZones: Array.from(originalConfiguredZones.entries()),
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
        const transformedZones: ZoneData[] = (response?.zones || []).map((zone: any) => {
          const smartConnectFqdn = zone.smartConnectFqdn;
          const ssip = zone.ssip;

          // Build IP list with SmartConnect FQDN formatted as "fqdn(ssip)"
          const ipList = (zone.ipAddresses || []).map((ip: string) => {
            if (ip === smartConnectFqdn && ssip) {
              return {
                label: `${ip}(${ssip})`,
                value: ip,
              };
            }
            return {
              label: ip,
              value: ip,
            };
          });

          return {
            id: zone.zoneName,
            numericId: zone.zoneId || 1,
            name: zone.zoneName,
            ipList,
            smartConnectSsip: ssip || undefined,           // SSIP for DNS resolution
            smartConnectDnsZone: zone.scDnsZone || undefined, // DNS zone for resolver config
          };
        });

        console.debug("[IsilonCredentials] Transformed zones:", transformedZones);
        setZones(transformedZones);

        // In edit mode, ensure all originally configured zones are selected
        if (isEditMode && originalConfiguredZones.size > 0) {
          const configuredZoneIds = Array.from(originalConfiguredZones.keys());
          setSelectedZoneIds((prev: string[]) => {
            const combined = new Set([...prev, ...configuredZoneIds]);
            return Array.from(combined);
          });
        }
      } catch (error: any) {
        console.error("[IsilonCredentials] Error fetching zones:", error);
        const errorMessage = error?.data?.message || error?.message || "Failed to fetch zones from server";
        setZonesError(errorMessage);
      } finally {
        setZonesLoading(false);
      }
    };

    fetchZones();
  }, [managementConsoleForm?.formState, certificateData, fetchZonesApi, isEditMode, originalConfiguredZones, setSelectedZoneIds]);

  return (
    <Box className="mt-4 flex flex-col p-6 w-full">
      <Box className="!bg-white shadow-[rgba(0,_0,_0,_0.24)_0px_3px_8px] p-6">
        <Text className="text-base font-semibold mb-4">Access Zones</Text>
        <Text className="text-sm text-gray-600 mb-4">
          Select one or more zones and enter SMB/NFS credentials for each selected zone.
        </Text>

        {/* Edit mode info banner */}
        {isEditMode && originalConfiguredZones.size > 0 && (
          <Box className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md mb-4">
            <NoticeTriangleIcon className="text-amber-600 mt-0.5 flex-shrink-0" size="16" />
            <Text className="text-sm text-amber-800">
              <strong>Edit Mode:</strong> Configured zones cannot be deselected.
              For configured protocols, you can change the IP address but it cannot be empty.
              You can add new zones or configure new protocols for existing zones.
            </Text>
          </Box>
        )}

        <Box className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
          <InfoIcon className="text-blue-600 mt-0.5 flex-shrink-0" size="16" />
          <Text className="text-sm text-blue-800">
            For each selected zone, you can configure NFS credentials, SMB credentials, or both.
            Only protocols with complete credentials (IP, username, and password) will be available for migration jobs.
          </Text>
        </Box>

        {zonesLoading ? (
          <Box className="flex flex-col items-center justify-center py-8">
            <InlineLoader />
            <Text className="mt-4 text-gray-600">Loading access zones...</Text>
          </Box>
        ) : zonesError ? (
          <Box className="flex flex-col items-center justify-center py-8 text-center">
            <Box className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-md max-w-md">
              <InfoIcon className="text-red-600 mt-0.5 flex-shrink-0" size="16" />
              <Text className="text-sm text-red-800">{zonesError}</Text>
            </Box>
          </Box>
        ) : zones.length === 0 ? (
          <Box className="flex flex-col items-center justify-center py-8 text-center">
            <Text className="text-gray-600">No access zones found.</Text>
            <Text className="text-sm text-gray-500 mt-2">
              Please verify your management console connection and try again.
            </Text>
          </Box>
        ) : isEditMode ? (
          // EDIT MODE TABLE - Completely separate implementation
          // Wrapper div with key forces remount when zones change to reinitialize selection state
          <div key={`edit-table-${zones.map(z => z.id).join('-')}`}>
            <EditModeTable
              zones={zones}
              isJobRunning={isJobRunning}
              selectedZoneIds={selectedZoneIds}
              setSelectedZoneIds={setSelectedZoneIds}
              zoneCredentials={zoneCredentials}
              setZoneCredentials={setZoneCredentials}
              originalConfiguredZones={originalConfiguredZones}
            />
          </div>
        ) : (
          // ADD MODE TABLE - Completely separate implementation
          <div key={`add-table-${zones.map(z => z.id).join('-')}`}>
            <AddModeTable
              zones={zones}
              isJobRunning={isJobRunning}
              selectedZoneIds={selectedZoneIds}
              setSelectedZoneIds={setSelectedZoneIds}
              zoneCredentials={zoneCredentials}
              setZoneCredentials={setZoneCredentials}
            />
          </div>
        )}
      </Box>
    </Box>
  );
};

export default IsilonCredentials;
