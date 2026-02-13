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
import { useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDispatch } from "react-redux";
import { setModalClose, setModalProps } from "@store/reducer/commonComponentSlice";
import BulkMigrateScheduleComponent from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/BulkMigrateScheduleComponent";
import MountPathConfigurationTable from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/MountPathConfigurationTable";
import { getOptionsFromArray } from "@/utils/common.utils";
import { nanoid } from "@reduxjs/toolkit";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import type { MigrationDetailsTableConfigurationType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";
import { isSourceDirectoryPathChildOrParent } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";
import TruncatedPathCell from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Mapping/components/CellRenderer/TruncatedPathCell";
import ExploreModal, { useExploreModal, SelectedItemInfo } from "@modules/storage-servers/file-server/file-server-overview/components/ExploreModal";
import type { VolumeType } from "@/types/app.type";

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
  } = useContext(BulkMigrateContext);
  const { setFieldValue } = mappingStepForm;
  const dispatch = useDispatch();

  const [key, setKey] = useState(nanoid());
  const [sourceDirectoryPath, setSourceDirectoryPath] = useState<string>("");
  const [destinationDirectoryPath, setDestinationDirectoryPath] = useState<string>("");
  const isPrefillingFromEditRef = useRef(false);
  const prevProtocolValueRef = useRef<string | undefined>(undefined);

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

  // Protocol options (NFS, SMB) for filtering if needed
  const protocolOptions = useMemo(() => {
    const _options = getOptionsFromArray(
      sourceFileServerDetails?.fileServers?.map((data) => data.protocol) || [
        "NFS",
        "SMB",
      ]
    );
    protocolForm.resetForm({ protocol: _options[0] });
    return _options;
  }, [sourceFileServerDetails?.fileServers?.length]);

  // Select Source Path dropdown: populated with export paths from the File Server Overview Export Path table
  const sourcePathOptions = useMemo(() => {
    if (!allExportPaths?.length) return [];
    const paths = allExportPaths.map((v) => v.volumePath);
    const uniquePaths = [...new Set(paths)].sort();
    return getOptionsFromArray(uniquePaths);
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

  // Destination Path options for the selected destination file server (from fileServerWithPathsMap)
  const destinationPathOptions = useMemo(() => {
    const serverId = destinationForm.formState.destinationFileServer?.value ?? "";
    const paths = fileServerWithPathsMap?.get(serverId) ?? [];
    return paths.map((p) => ({
      label: p.pathName,
      value: p.pathId,
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

  // Reset destination path when destination file server changes (skip when change is from Edit prefill)
  useEffect(() => {
    if (isPrefillingFromEditRef.current) {
      isPrefillingFromEditRef.current = false;
      return;
    }
    destinationForm.resetForm({
      ...destinationForm.formState,
      destinationPath: "" as any,
    });
  }, [destinationForm.formState.destinationFileServer?.value]);

  // Prefill form when user clicks Edit on a mapping row
  useEffect(() => {
    if (!mappingToEdit) return;
    isPrefillingFromEditRef.current = true;
    const pathName = mappingToEdit.sourcePath?.sourcePathName ?? "";
    sourcePathForm.resetForm({
      selectedSourcePath: pathName ? { value: pathName, label: pathName } : "",
    });
    setSourceDirectoryPath(
      mappingToEdit.sourceDirectoryPath === "-" || !mappingToEdit.sourceDirectoryPath
        ? ""
        : mappingToEdit.sourceDirectoryPath
    );
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
    setDestinationDirectoryPath(
      mappingToEdit.destinationDirectoryPath === "-" || !mappingToEdit.destinationDirectoryPath
        ? ""
        : mappingToEdit.destinationDirectoryPath
    );
    setMappingToEdit(null);
  }, [mappingToEdit, setMappingToEdit]);

  // Source path, destination file server, and destination path required; directory paths optional (shown as "-" when not set)
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
    const existingRowsSameSource = currentRows.filter(
      (r) => (r.sourcePath?.sourcePathName ?? "") === sourcePathValue
    );
    const conflictingRow = existingRowsSameSource.find((row) =>
      isSourceDirectoryPathChildOrParent(
        currentSourceDirPath,
        row.sourceDirectoryPath ?? "-"
      )
    );
    if (conflictingRow) {
      const existingDisplay =
        conflictingRow.sourceDirectoryPath === "-" || !conflictingRow.sourceDirectoryPath
          ? "(whole export)"
          : conflictingRow.sourceDirectoryPath;
      const currentDisplay =
        currentSourceDirPath === "-" ? "(whole export)" : currentSourceDirPath;
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
    setFieldValue("migrationDetailsTableConfigurationValue", [
      ...currentRows,
      newRow,
    ]);
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
      <Card className="min-h-24 p-6">
        <Text bold className="mb-3">
          Job Schedule
        </Text>
        <BulkMigrateScheduleComponent
          mappingStepForm={mappingStepForm}
          variant="normal_run"
        />
      </Card>

      {/* Source and Destination Path Selectors card */}
      <Card className="mt-6 p-6 flex flex-col">
        <Text bold className="mb-6 text-base text-gray-900">
          Source and Destination Path Selectors
        </Text>

        {/* 3 rows x 2 columns so "+ Add ..." links sit on the same row */}
        <Box className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 max-w-4xl items-start min-w-0">
          {/* Row 1 */}
          <Box className="flex flex-col gap-2">
            <Text className="text-sm font-semibold text-gray-900">Source File Server</Text>
            <Text bold className="text-base">
              {isFetching && !sourceFileServerDisplayName
                ? "Loading..."
                : sourceFileServerDisplayName || "—"}
            </Text>
          </Box>
          <Box className="flex flex-col gap-2 md:pl-14 w-full max-w-[360px]">
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
          </Box>
          {/* Row 2 - all dropdowns same width as Select Destination File Server */}
          <Box className="flex flex-col gap-2 w-full max-w-[360px]">
            <FormFieldSelect
              label="Select Source Path"
              labelClassName="text-sm font-semibold text-gray-900"
              name="selectedSourcePath"
              form={sourcePathForm}
              options={sourcePathOptions}
              disabled={!sourceFileServerDetails || !sourcePathOptions.length}
              className="w-full"
              placeholder="Select Source Path"
            />
          </Box>
          <Box className="flex flex-col gap-2 md:pl-14 w-full max-w-[360px]">
            <FormFieldSelect
              label="Select Destination Path"
              labelClassName="text-sm font-semibold text-gray-900"
              name="destinationPath"
              form={destinationForm}
              options={destinationPathOptions}
              disabled={
                !destinationForm.formState.destinationFileServer?.value ||
                !destinationPathOptions.length
              }
              className="w-full"
              placeholder="Select Destination Path"
            />
          </Box>
          {/* Row 3 - both Add links at same level; min-w-0 + truncation prevent long paths from overlapping */}
          <Box className="flex min-w-0 flex-col gap-2 min-h-[2.5rem] overflow-hidden">
            {!sourceDirectoryPath ? (
              <Text
                component="span"
                className={`text-sm ${sourcePathForm.formState.selectedSourcePath?.value ? "cursor-pointer hover:underline" : "cursor-not-allowed opacity-60"}`}
                style={{
                  color: sourcePathForm.formState.selectedSourcePath?.value
                    ? "#0067c5"
                    : "#6b7280",
                }}
                onClick={
                  sourcePathForm.formState.selectedSourcePath?.value
                    ? openSourceExploreModal
                    : undefined
                }
              >
                + Add Source Directory
              </Text>
            ) : (
              <>
                <Text className="text-sm font-semibold text-gray-900">Source Directory</Text>
                <TruncatedPathCell value={sourceDirectoryPath} />
                <Text
                  component="span"
                  className="cursor-pointer text-sm hover:underline block mt-1"
                  style={{ color: "#0067c5" }}
                  onClick={openSourceExploreModal}
                >
                  - Edit Source Directory
                </Text>
              </>
            )}
          </Box>
          <Box className="flex min-w-0 flex-col gap-2 min-h-[2.5rem] md:pl-14 w-full max-w-[360px] overflow-hidden">
            {!destinationDirectoryPath ? (
              <Text
                component="span"
                className={`text-sm ${canAddMapping ? "cursor-pointer hover:underline" : "cursor-not-allowed opacity-60"}`}
                style={{
                  color: canAddMapping ? "#0067c5" : "#6b7280",
                }}
                onClick={
                  canAddMapping ? openDestinationExploreModal : undefined
                }
              >
                + Add Destination Directory
              </Text>
            ) : (
              <>
                <Text className="text-sm font-semibold text-gray-900">Destination Directory</Text>
                <TruncatedPathCell value={destinationDirectoryPath} />
                <Text
                  component="span"
                  className="cursor-pointer text-sm hover:underline block mt-1"
                  style={{ color: "#0067c5" }}
                  onClick={openDestinationExploreModal}
                >
                  - Edit Destination Directory
                </Text>
              </>
            )}
          </Box>
        </Box>

        <Box className="flex justify-end mt-8">
          <Button
            color="primary"
            disabled={!canAddMapping}
            onClick={handleAddMapping}
          >
            + Add Mapping
          </Button>
        </Box>

        {/* Mappings table - headers always visible; when no mappings show empty table + No Data message */}
        <Box className="mt-6">
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
    </>
  );
};

export default Mapping;
