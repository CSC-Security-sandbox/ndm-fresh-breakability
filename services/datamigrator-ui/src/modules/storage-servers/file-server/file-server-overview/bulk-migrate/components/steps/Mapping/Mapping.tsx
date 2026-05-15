import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";
import { Box } from "@components/container/index";
import {
  Card,
  FormFieldSelect,
  Text,
  Button,
  Table,
  useForm,
} from "@netapp/bxp-design-system-react";
import { Autocomplete, TextField } from "@mui/material";
import { useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDispatch } from "react-redux";
import { setModalClose, setModalProps } from "@store/reducer/commonComponentSlice";
import BulkMigrateScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/BulkMigrateScheduleComponent";
import MountPathConfigurationTable from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/MountPathConfigurationTable";
import { getOptionsFromArray } from "@/utils/common.utils";
import { nanoid } from "@reduxjs/toolkit";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import type { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import {
  findConflictingDestinationDirectoryMapping,
  findConflictingSourceDirectoryMapping,
  normalizeDirectoryPath,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import TruncatedPathCell from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/TruncatedPathCell";
import ExploreModal, { useExploreModal, SelectedItemInfo } from "@modules/storage-servers/file-server/file-server-overview/components/ExploreModal";
import type { VolumeType } from "@/types/app.type";
import { AddIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { CloseIcon, EditIcon } from "@netapp/bxp-style/react-icons/Action";

const Mapping = () => {
  const {
    sourceFileServerDetails,
    mappingStepForm,
    protocolForm,
    setSelectedMountPathsId,
    setSelectedReviewIds,
    mappingStepTableState,
    isFetching,
    allExportPaths,
    allFileServers,
    fileServerWithPathsMap,
    mappingToEdit,
    setMappingToEdit,
    setMigrationDetailsTableConfiguration,
  } = useContext(BulkMigrateContext);
  const { setFieldValue } = mappingStepForm;
  const dispatch = useDispatch();

  const [key, setKey] = useState(nanoid());
  const [sourceDirectoryPath, setSourceDirectoryPath] = useState<string>("");
  const [destinationDirectoryPath, setDestinationDirectoryPath] = useState<string>("");
  const isPrefillingFromEditRef = useRef(false);
  const prevProtocolValueRef = useRef<string | undefined>(undefined);
  const mappingsTableRef = useRef<HTMLDivElement>(null);

  // Form for Select Source Path dropdown (export paths from File Server Overview table)
  const sourcePathForm = useForm({ selectedSourcePath: "" });

  // Form for Destination File Server and Destination Path; use empty string so placeholder shows in dropdown (like Select Source Path)
  const destinationForm = useForm({
    destinationFileServer: "" as any,
    destinationPath: "" as any,
  });

  // ExploreModal hooks for source and destination directory selection
  const {
    isOpen: isSourceExploreModalOpen,
    openExploreModal: openSourceExploreModal,
    closeExploreModal: closeSourceExploreModal,
  } = useExploreModal();

  const {
    isOpen: isDestinationExploreModalOpen,
    openExploreModal: openDestinationExploreModal,
    closeExploreModal: closeDestinationExploreModal,
  } = useExploreModal();

  // Get the actual file server ID for source (must match selected protocol)
  const sourceFileServerId = useMemo(() => {
    if (!sourceFileServerDetails?.fileServers?.length) return "";
    const protocol = protocolForm.formState.protocol?.value ?? "";
    // Find the file server that matches the selected protocol
    const matchingFileServer = sourceFileServerDetails.fileServers.find(
      (fs) => fs.protocol === protocol
    );
    // Fall back to first file server if no protocol match
    return matchingFileServer?.id || sourceFileServerDetails.fileServers[0]?.id || "";
  }, [sourceFileServerDetails?.fileServers, protocolForm.formState.protocol?.value]);

  // Get the destination file server config ID (from dropdown selection)
  const destinationFileServerConfigId = useMemo(() => {
    return destinationForm.formState.destinationFileServer?.value || "";
  }, [destinationForm.formState.destinationFileServer?.value]);

  // Get destination file server details (by config ID)
  const destinationFileServerDetails = useMemo(() => {
    if (!destinationFileServerConfigId || !allFileServers?.length) return null;
    return allFileServers.find((fs) => fs.id === destinationFileServerConfigId);
  }, [destinationFileServerConfigId, allFileServers]);

  // Get the actual file server ID for destination (for API calls)
  // Must match the selected protocol since a config can have multiple file servers (NFS, SMB)
  const destinationFileServerId = useMemo(() => {
    if (!destinationFileServerDetails?.fileServers?.length) return "";
    const protocol = protocolForm.formState.protocol?.value ?? "";
    // Find the file server that matches the selected protocol
    const matchingFileServer = destinationFileServerDetails.fileServers.find(
      (fs) => fs.protocol === protocol
    );
    // Fall back to first file server if no protocol match
    return matchingFileServer?.id || destinationFileServerDetails.fileServers[0]?.id || "";
  }, [destinationFileServerDetails, protocolForm.formState.protocol?.value]);

  // Get destination export paths
  const destinationExportPaths = useMemo(() => {
    const paths = fileServerWithPathsMap?.get(destinationFileServerConfigId) ?? [];
    return paths.map((p) => ({
      id: p.pathId,
      volumePath: p.pathName,
    })) as VolumeType[];
  }, [destinationFileServerConfigId, fileServerWithPathsMap]);

  // Get the selected source export path ID (for ExploreModal)
  const selectedSourceExportPathId = useMemo(() => {
    const selectedPathValue = sourcePathForm.formState.selectedSourcePath?.value ?? "";
    if (!selectedPathValue || !allExportPaths?.length) return "";
    const exportPath = allExportPaths.find((p) => p.volumePath === selectedPathValue);
    return exportPath?.id ?? "";
  }, [sourcePathForm.formState.selectedSourcePath?.value, allExportPaths]);

  // Get the selected destination export path ID (for ExploreModal)
  const selectedDestinationExportPathId = useMemo(() => {
    return destinationForm.formState.destinationPath?.value ?? "";
  }, [destinationForm.formState.destinationPath?.value]);

  // Handle source directory selection from ExploreModal
  const handleSourceExploreConfirm = useCallback(
    (selectedItems: SelectedItemInfo[], _exportPath: VolumeType) => {
      if (selectedItems.length > 0) {
        setSourceDirectoryPath(selectedItems[0].path);
      } else {
        // User cleared the selection
        setSourceDirectoryPath("");
      }
      closeSourceExploreModal();
    },
    [closeSourceExploreModal]
  );

  // Handle destination directory selection from ExploreModal
  const handleDestinationExploreConfirm = useCallback(
    (selectedItems: SelectedItemInfo[], _exportPath: VolumeType) => {
      if (selectedItems.length > 0) {
        setDestinationDirectoryPath(selectedItems[0].path);
      } else {
        // User cleared the selection
        setDestinationDirectoryPath("");
      }
      closeDestinationExploreModal();
    },
    [closeDestinationExploreModal]
  );

  // Source file server is auto-populated from the file server selected in the left bar (URL: /file-server/:fileServerId/bulk-migrate)
  const sourceFileServerDisplayName = useMemo(() => {
    if (!sourceFileServerDetails?.configName) return "";

    const configName = sourceFileServerDetails.configName;
    const serverType =
      sourceFileServerDetails?.serverType ||
      sourceFileServerDetails?.configType;
    const fileServerName =
      sourceFileServerDetails?.fileServers?.[0]?.fileServerName;

    if (serverType && serverType !== "OtherNAS" && fileServerName) {
      return `${configName}:${fileServerName}`;
    }

    return configName;
  }, [sourceFileServerDetails]);

  const options = useMemo(() => {
    const _options = getOptionsFromArray(
      sourceFileServerDetails?.fileServers?.map((data) => data.protocol) || [
        "NFS",
        "SMB",
      ]
    );
    protocolForm.resetForm({ protocol: _options[0] });
    return _options;
  }, [sourceFileServerDetails?.fileServers?.length]);

  // Select Source Path dropdown: same as overview/ExploreModal - show all export paths, fade/disable those with isDisabled
  const sourcePathOptions = useMemo(() => {
    if (!allExportPaths?.length) return [];
    const pathToDisabled = new Map<string, boolean>();
    allExportPaths.forEach((v) => {
      if (v.isDisabled === true) pathToDisabled.set(v.volumePath, true);
    });
    const paths = allExportPaths.map((v) => v.volumePath);
    const uniquePaths = [...new Set(paths)].sort();
    return uniquePaths.map((volumePath) => ({
      label: volumePath,
      value: volumePath,
      isDisabled: pathToDisabled.get(volumePath) === true,
    }));
  }, [allExportPaths]);

  // Destination File Server options (same as table: exclude source, active only, matching protocol)
  const destinationFileServerOptions = useMemo(() => {
    if (!allFileServers?.length || !sourceFileServerDetails?.id) return [];
    const protocol = protocolForm.formState.protocol?.value ?? "";
    return allFileServers
      .filter(
        (server) =>
          server.id !== sourceFileServerDetails.id &&
          server.status === FILE_SERVER_STATUS_ENUM.ACTIVE &&
          server.fileServers?.some((fs) => fs.protocol === protocol)
      )
      .map((server) => ({
        label: server.configName ?? server.id,
        value: server.id,
      }));
  }, [
    allFileServers,
    sourceFileServerDetails?.id,
    protocolForm.formState.protocol?.value,
  ]);

  // Destination Path options: same as overview - show all export paths, fade/disable those that are disabled/invalid/unreachable
  const destinationPathOptions = useMemo(() => {
    const serverId = destinationForm.formState.destinationFileServer?.value ?? "";
    const paths = fileServerWithPathsMap?.get(serverId) ?? [];
    return paths.map((p) => ({
      label: p.pathName,
      value: p.pathId,
      isDisabled:
        p.isDisabled === true ||
        p.isValid === false ||
        (p.reachableCount !== undefined && p.reachableCount === 0),
    }));
  }, [
    destinationForm.formState.destinationFileServer?.value,
    fileServerWithPathsMap,
  ]);

  useEffect(() => {
    const currentProtocol = protocolForm.formState.protocol?.value ?? "";
    const prevProtocol = prevProtocolValueRef.current;
    prevProtocolValueRef.current = currentProtocol;
    if (prevProtocol !== undefined && prevProtocol !== currentProtocol) {
      setKey(nanoid());
      setSelectedMountPathsId([]);
      setSelectedReviewIds([]);
      setFieldValue("selectedMountPathsId", []);
    }
  }, [protocolForm.formState.protocol?.value, setFieldValue, setSelectedMountPathsId, setSelectedReviewIds]);

  // Reset source directory when Select Source Path changes (skip when change is from Edit prefill; ref is cleared by destination-path effect).
  useEffect(() => {
    if (isPrefillingFromEditRef.current) return;
    setSourceDirectoryPath("");
  }, [sourcePathForm.formState.selectedSourcePath?.value]);

  // Reset destination path when destination file server changes (skip when change is from Edit prefill).
  // Only depend on destinationFileServer value so we don't run on every form update (e.g. when user selects path – that would reset the path).
  useEffect(() => {
    if (isPrefillingFromEditRef.current) return;
    destinationForm.resetForm({
      ...destinationForm.formState,
      destinationPath: "" as any,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omit destinationForm: it changes when path is selected and would reset the path
  }, [destinationForm.formState.destinationFileServer?.value]);

  // Reset destination directory when Select Destination Path changes (skip when change is from Edit prefill).
  useEffect(() => {
    if (isPrefillingFromEditRef.current) return;
    setDestinationDirectoryPath("");
  }, [destinationForm.formState.destinationPath?.value]);

  // Prefill form when user clicks Edit on a mapping row
  useEffect(() => {
    if (!mappingToEdit) return;
    isPrefillingFromEditRef.current = true;
    const pathName = mappingToEdit.sourcePath?.sourcePathName ?? "";
    sourcePathForm.resetForm({
      selectedSourcePath: pathName ? { value: pathName, label: pathName } : "",
    });
    setSourceDirectoryPath(normalizeDirectoryPath(mappingToEdit.sourceDirectoryPath));
    const destServerId = mappingToEdit.destinationFileServerDetails?.destinationFileServerId ?? "";
    const destServerName = mappingToEdit.destinationFileServerDetails?.destinationFileServerName ?? "";
    const destPathId = mappingToEdit.destinationPathDetails?.destinationPathId ?? "";
    const destPathName = mappingToEdit.destinationPathDetails?.destinationPathName ?? "";
    destinationForm.resetForm({
      destinationFileServer: destServerId
        ? { value: destServerId, label: destServerName }
        : ("" as any),
      destinationPath: destPathId
        ? { value: destPathId, label: destPathName }
        : ("" as any),
    });
    setDestinationDirectoryPath(normalizeDirectoryPath(mappingToEdit.destinationDirectoryPath));
    setMappingToEdit(null);
  }, [
    mappingToEdit,
    setMappingToEdit,
    sourcePathForm,
    destinationForm,
    setSourceDirectoryPath,
    setDestinationDirectoryPath,
  ]);

  // Clear prefill ref after all reset effects have run (so they can skip in the post-prefill render and not clear directory state).
  useEffect(() => {
    if (!mappingToEdit) {
      isPrefillingFromEditRef.current = false;
    }
  }, [mappingToEdit]);

  // Destination file server + destination path only (for "+ Add Destination Directory" – no source path required)
  const canAddDestinationDirectory = useMemo(() => {
    const destServer = destinationForm.formState.destinationFileServer?.value ?? "";
    const destPath = destinationForm.formState.destinationPath?.value ?? "";
    return !!(destServer && destPath);
  }, [
    destinationForm.formState.destinationFileServer?.value,
    destinationForm.formState.destinationPath?.value,
  ]);

  // Source path, destination file server, and destination path required for adding a mapping; directory paths optional
  const canAddMapping = useMemo(() => {
    const sp = sourcePathForm.formState.selectedSourcePath?.value ?? "";
    const destServer = destinationForm.formState.destinationFileServer?.value ?? "";
    const destPath = destinationForm.formState.destinationPath?.value ?? "";
    return !!(sp && destServer && destPath);
  }, [
    sourcePathForm.formState.selectedSourcePath?.value,
    destinationForm.formState.destinationFileServer?.value,
    destinationForm.formState.destinationPath?.value,
  ]);

  const handleAddMapping = () => {
    if (!canAddMapping || !sourceFileServerDetails) return;
    const sourcePathValue = sourcePathForm.formState.selectedSourcePath?.value ?? "";
    const currentSourceDirPath = sourceDirectoryPath || "-";
    const currentRows: MigrationDetailsTableConfigurationType[] =
      mappingStepForm.values.migrationDetailsTableConfigurationValue ?? [];
    const conflictingRow = findConflictingSourceDirectoryMapping(
      currentRows,
      sourcePathValue,
      currentSourceDirPath
    );
    if (conflictingRow) {
      const currentNormalized = normalizeDirectoryPath(currentSourceDirPath);
      const existingNormalized = normalizeDirectoryPath(conflictingRow.sourceDirectoryPath);
      const currentDisplay = currentNormalized === "" ? "(whole export)" : currentNormalized;
      const existingDisplay = existingNormalized === "" ? "(whole export)" : existingNormalized;
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: "Cannot add mapping",
          modalContent: (
            <Box className="flex flex-col gap-3 text-gray-700">
              <Text>
                The source directory is a parent or child of an existing mapping for the same source export path.
              </Text>
              <Text component="span" className="text-sm">
                Current: {currentDisplay}
                <br />
                Existing: {existingDisplay}
              </Text>
              <Text component="span" className="text-sm">
                Please choose a different path or remove the conflicting mapping first.
              </Text>
            </Box>
          ),
          modalFooter: (
            <Button color="primary" onClick={() => dispatch(setModalClose())}>
              OK
            </Button>
          ),
        })
      );
      return;
    }
    const currentDestDirPath = destinationDirectoryPath || "-";
    const destFileServerId = destinationForm.formState.destinationFileServer?.value ?? "";
    const destPathId = destinationForm.formState.destinationPath?.value ?? "";
    const conflictingDestRow = findConflictingDestinationDirectoryMapping(
      currentRows,
      destFileServerId,
      destPathId,
      currentDestDirPath
    );
    if (conflictingDestRow) {
      const currentNormalized = normalizeDirectoryPath(currentDestDirPath);
      const existingNormalized = normalizeDirectoryPath(
        conflictingDestRow.destinationDirectoryPath
      );
      const currentDisplay = currentNormalized === "" ? "(whole export)" : currentNormalized;
      const existingDisplay = existingNormalized === "" ? "(whole export)" : existingNormalized;
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: "Cannot add mapping",
          modalContent: (
            <Box className="flex flex-col gap-3 text-gray-700">
              <Text>
                The destination directory is a parent or child of an existing mapping for the same destination file server and path.
              </Text>
              <Text component="span" className="text-sm">
                Current: {currentDisplay}
                <br />
                Existing: {existingDisplay}
              </Text>
              <Text component="span" className="text-sm">
                Please choose a different path or remove the conflicting mapping first.
              </Text>
            </Box>
          ),
          modalFooter: (
            <Button color="primary" onClick={() => dispatch(setModalClose())}>
              OK
            </Button>
          ),
        })
      );
      return;
    }
    const volume = allExportPaths.find((v) => v.volumePath === sourcePathValue);
    const protocol = protocolForm.formState.protocol?.value ?? "";
    const nextId =
      currentRows.length > 0
        ? Math.max(...currentRows.map((r) => r.id), 0) + 1
        : 0;
    const newRow: MigrationDetailsTableConfigurationType = {
      id: nextId,
      sourceFileServerDetails,
      sourcePath: {
        volume: volume ?? ({} as any),
        sourcePathName: sourcePathValue,
        sourcePathId: volume?.id ?? "",
      },
      sourceDirectoryPath: sourceDirectoryPath || "-",
      protocol,
      destinationFileServerDetails: {
        destinationFileServerId:
          destinationForm.formState.destinationFileServer?.value ?? "",
        destinationFileServerName:
          destinationForm.formState.destinationFileServer?.label ?? "",
      },
      destinationPathDetails: {
        destinationPathId:
          destinationForm.formState.destinationPath?.value ?? "",
        destinationPathName:
          destinationForm.formState.destinationPath?.label ?? "",
      },
      destinationDirectoryPath: destinationDirectoryPath || "-",
      discoveryJobCount: "",
      migrationJobCount: "",
      cutoverJobCount: "",
    };
    const nextRows = [...currentRows, newRow];
    setFieldValue("migrationDetailsTableConfigurationValue", nextRows);
    setMigrationDetailsTableConfiguration(nextRows);
    setFieldValue("selectedMountPathsId", [
      ...(mappingStepForm.values.selectedMountPathsId ?? []),
      String(newRow.id),
    ]);
    // Clear form so fields are empty for next mapping
    sourcePathForm.resetForm({ selectedSourcePath: "" });
    setSourceDirectoryPath("");
    destinationForm.resetForm({
      destinationFileServer: "" as any,
      destinationPath: "" as any,
    });
    setDestinationDirectoryPath("");
    
    // Scroll to mappings table after adding a mapping
    setTimeout(() => {
      mappingsTableRef.current?.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
    }, 100);
  };

  const hasMappings =
    (mappingStepTableState?.organizedRows?.length ?? 0) > 0;

  return (
    <>
      {/* Source Directory ExploreModal */}
      <ExploreModal
        isOpen={isSourceExploreModalOpen}
        onClose={closeSourceExploreModal}
        onConfirm={handleSourceExploreConfirm}
        fileServerName={sourceFileServerDisplayName || ""}
        fileServerId={sourceFileServerId}
        allExportPaths={allExportPaths}
        skipExportPathsView={true}
        preSelectedExportPathId={selectedSourceExportPathId}
        initialSelectedPath={sourceDirectoryPath || undefined}
      />

      {/* Destination Directory ExploreModal */}
      <ExploreModal
        isOpen={isDestinationExploreModalOpen}
        onClose={closeDestinationExploreModal}
        onConfirm={handleDestinationExploreConfirm}
        fileServerName={destinationFileServerDetails?.configName || ""}
        fileServerId={destinationFileServerId}
        allExportPaths={destinationExportPaths}
        skipExportPathsView={true}
        preSelectedExportPathId={selectedDestinationExportPathId}
        initialSelectedPath={destinationDirectoryPath || undefined}
      />

      {/* Job Schedule card */}
      <Card className="min-h-24 p-6 mx-auto w-4/6">
        <Text bold className="mb-3">
          Job Schedule
        </Text>
        <BulkMigrateScheduleComponent
          mappingStepForm={mappingStepForm}
          variant="normal_run"
        />
      </Card>

      {/* Source and Destination Path Selectors card */}
      <Card className="mt-6 pt-6 pb-6 pl-8 pr-8 flex flex-col mx-auto w-4/6">
        <Text bold className="mb-6 text-base text-gray-900">
          Source and Destination Path Selectors
        </Text>

        {/* 3 rows x 2 columns so "+ Add ..." links sit on the same row */}
        <Box className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 items-start min-w-0">
          {/* Row 1 */}
          <Box className="flex flex-col md:pr-10 gap-2">
            <Text className="text-sm font-semibold text-gray-900">Source File Server</Text>
            <Text bold className="text-base">
              {isFetching && !sourceFileServerDisplayName
                ? "Loading..."
                : sourceFileServerDisplayName || "—"}
            </Text>
          </Box>
          <Box className="flex flex-col gap-2 md:pl-10 w-full">
            <div data-testid="bulk-migrate-dst-fs-select">
              <FormFieldSelect
                label="Select Destination File Server"
                labelClassName="text-sm font-semibold text-gray-900"
                name="destinationFileServer"
                form={destinationForm}
                options={destinationFileServerOptions}
                disabled={!sourceFileServerDetails || !destinationFileServerOptions.length}
                className="w-full"
                placeholder="Select Destination File Server"
              />
            </div>
          </Box>
          {/* Row 2 - all dropdowns same width as Select Destination File Server; use Autocomplete so disabled export paths are faded (mirrors overview/ExploreModal) */}
          <Box className="flex flex-col gap-2 md:pr-10 w-full">
            <Text className="text-sm font-semibold text-gray-900">Select Source Path</Text>
            <Autocomplete
              options={sourcePathOptions}
              getOptionLabel={(opt) => opt?.label ?? ""}
              getOptionDisabled={(opt) => opt?.isDisabled === true}
              value={
                sourcePathOptions.find(
                  (o) => o.value === sourcePathForm.formState.selectedSourcePath?.value
                ) ?? null
              }
              onChange={(_, newValue) => {
                sourcePathForm.handleFormChange(newValue ?? "", {
                  name: "selectedSourcePath",
                });
              }}
              disabled={!sourceFileServerDetails || !sourcePathOptions.length}
              size="small"
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Select Source Path"
                  inputProps={{ ...params.inputProps, "data-testid": "bulk-migrate-src-path-input" }}
                />
              )}
              renderOption={(props, option) => (
                <li
                  {...props}
                  key={option.value}
                  data-testid={`bulk-migrate-src-path-option-${option.value}`}
                  style={{
                    ...(props as React.HTMLAttributes<HTMLLIElement>).style,
                    opacity: option.isDisabled ? 0.5 : 1,
                  }}
                >
                  {option.label}
                </li>
              )}
            />
          </Box>
          <Box className="flex flex-col gap-2 md:pl-10 w-full">
            <Text className="text-sm font-semibold text-gray-900">Select Destination Path</Text>
            <Autocomplete
              options={destinationPathOptions}
              getOptionLabel={(opt) => opt?.label ?? ""}
              getOptionDisabled={(opt) => opt?.isDisabled === true}
              value={
                destinationPathOptions.find(
                  (o) => o.value === destinationForm.formState.destinationPath?.value
                ) ?? null
              }
              onChange={(_, newValue) => {
                destinationForm.handleFormChange(newValue ?? "", {
                  name: "destinationPath",
                });
              }}
              disabled={
                !destinationForm.formState.destinationFileServer?.value ||
                !destinationPathOptions.length
              }
              size="small"
              renderInput={(params) => (
                <TextField
                  {...params}
                  placeholder="Select Destination Path"
                  inputProps={{ ...params.inputProps, "data-testid": "bulk-migrate-dst-path-input" }}
                />
              )}
              renderOption={(props, option) => (
                <li
                  {...props}
                  key={option.value}
                  data-testid={`bulk-migrate-dst-path-option-${option.value}`}
                  style={{
                    ...(props as React.HTMLAttributes<HTMLLIElement>).style,
                    opacity: option.isDisabled ? 0.5 : 1,
                  }}
                >
                  {option.label}
                </li>
              )}
            />
          </Box>
          {/* Row 3 - both Add links at same level; min-w-0 + truncation prevent long paths from overlapping */}
          <Box className="flex min-w-0 flex-col gap-2 md:pr-10 min-h-[2.5rem] overflow-hidden">
            {!sourceDirectoryPath ? (
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 text-sm border-0 bg-transparent p-0 font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 rounded ${sourcePathForm.formState.selectedSourcePath?.value ? "cursor-pointer hover:underline" : "cursor-not-allowed opacity-60"}`}
                style={{
                  color: sourcePathForm.formState.selectedSourcePath?.value
                    ? "#0067c5"
                    : "#6b7280",
                }}
                aria-label="Add source directory"
                disabled={!sourcePathForm.formState.selectedSourcePath?.value}
                onClick={
                  sourcePathForm.formState.selectedSourcePath?.value
                    ? openSourceExploreModal
                    : undefined
                }
              >
                <AddIcon size={16} aria-hidden />
                Add Source Directory
              </button>
            ) : (
              <>
                <Text className="text-sm font-semibold text-gray-900">Source Directory</Text>
                <TruncatedPathCell value={sourceDirectoryPath} />
                <Box className="flex items-center gap-3 mt-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 cursor-pointer text-sm hover:underline border-0 bg-transparent p-0 font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 rounded"
                    style={{ color: "#0067c5" }}
                    aria-label="Edit source directory"
                    onClick={openSourceExploreModal}
                  >
                    <EditIcon size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center cursor-pointer text-sm hover:underline border-0 bg-transparent p-0 font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 rounded"
                    style={{ color: "#0067c5" }}
                    aria-label="Remove source directory"
                    onClick={() => setSourceDirectoryPath("")}
                  >
                    <CloseIcon size={24} aria-hidden />
                    Remove
                  </button>
                </Box>
              </>
            )}
          </Box>
          <Box className="flex min-w-0 flex-col gap-2 min-h-[2.5rem] md:pl-10 w-full overflow-hidden">
            {!destinationDirectoryPath ? (
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 text-sm border-0 bg-transparent p-0 font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 rounded ${canAddDestinationDirectory ? "cursor-pointer hover:underline" : "cursor-not-allowed opacity-60"}`}
                style={{
                  color: canAddDestinationDirectory ? "#0067c5" : "#6b7280",
                }}
                aria-label="Add destination directory"
                disabled={!canAddDestinationDirectory}
                onClick={
                  canAddDestinationDirectory ? openDestinationExploreModal : undefined
                }
              >
                <AddIcon size={16} aria-hidden />
                Add Destination Directory
              </button>
            ) : (
              <>
                <Text className="text-sm font-semibold text-gray-900">Destination Directory</Text>
                <TruncatedPathCell value={destinationDirectoryPath} />
                <Box className="flex items-center gap-3 mt-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 cursor-pointer text-sm hover:underline border-0 bg-transparent p-0 font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 rounded"
                    style={{ color: "#0067c5" }}
                    aria-label="Edit destination directory"
                    onClick={openDestinationExploreModal}
                  >
                    <EditIcon size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center cursor-pointer text-sm hover:underline border-0 bg-transparent p-0 font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 rounded"
                    style={{ color: "#0067c5" }}
                    aria-label="Remove destination directory"
                    onClick={() => setDestinationDirectoryPath("")}
                  >
                    <CloseIcon size={24} aria-hidden />
                    Remove
                  </button>
                </Box>
              </>
            )}
          </Box>
        </Box>

        <Box className="flex justify-center mt-8">
          <Button
            data-testid="btn-add-mapping"
            color="primary"
            disabled={!canAddMapping}
            onClick={handleAddMapping}
            data-testid="btn-add-mapping"
          >
            <Box className="inline-flex items-center gap-1.5">
              <AddIcon size={20} aria-hidden />
              Add Mapping
            </Box>
          </Button>
        </Box>
      </Card>
      
      <div ref={mappingsTableRef}>
        <Card className="mt-6 p-4">
          {/* Mappings table - headers always visible; when no mappings show empty table + No Data message */}
          <Box>
            {hasMappings ? (
              <MountPathConfigurationTable key={key} />
            ) : (
              <Box className="border border-gray-200 rounded-lg overflow-hidden">
                {mappingStepTableState?.columns?.length ? (
                  <Table
                    columns={mappingStepTableState.columns}
                    rows={[]}
                    sortState={mappingStepTableState.sortState}
                    toggleSort={mappingStepTableState.toggleSort}
                    filterState={mappingStepTableState.filterState}
                    updateFilterState={mappingStepTableState.updateFilterState}
                  />
                ) : null}
              </Box>
            )}
          </Box>
        </Card>
      </div>
    </>
  );
};

export default Mapping;
