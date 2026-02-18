/* eslint-disable */
// @ts-nocheck
import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Button,
  Toggle,
  Text,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import { setAsupEnabled } from "@store/reducer/asupSlice";
import {
  useUpdateAsupSettingsMutation,
  useGetMigrationAnalysisQuery,
  useTriggerAsupTransmissionMutation,
} from "@api/asupApi";
import { notify } from "@components/notification/NotificationWrapper";
import Box from "@/components/container/Box";
import useIsAppAdmin from "@hooks/useIsAppAdmin";

type ConfirmModalType = "enable" | "disable" | null;

/**
 * AsupMetricsContent - Displays ASUP settings and metrics preview in the Help drawer.
 * 
 * - Shows detailed ASUP information including what data is collected
 * - Shows toggle to enable/disable (only App Admin can modify)
 * - Project Admin and Project Viewer can only view
 * - Initial setting comes from instance creator's choice on login page
 */
const AsupMetricsContent = () => {
  const dispatch = useDispatch();
  const { enabled, lastTransmission } = useSelector(
    (state: RootStateType) => state.asupSlice
  );
  const [updateSettings] = useUpdateAsupSettingsMutation();
  const [triggerTransmission, { isLoading: isTransmitting }] = useTriggerAsupTransmissionMutation();
  const { data: metricsData, isLoading: isLoadingMetrics } = useGetMigrationAnalysisQuery(undefined, {
    skip: !enabled,
  });
  const isAppAdmin = useIsAppAdmin();
  
  // State for confirmation modal
  const [confirmModalType, setConfirmModalType] = useState<ConfirmModalType>(null);

  // Handle toggle - only App Admin can toggle
  const handleToggle = useCallback(() => {
    if (!isAppAdmin) {
      notify.warning("Only App Admins can modify ASUP Metrics Sharing settings");
      return;
    }
    
    if (!enabled) {
      setConfirmModalType("enable");
    } else {
      setConfirmModalType("disable");
    }
  }, [enabled, isAppAdmin]);

  // Handle confirm enable
  const handleConfirmEnable = useCallback(async () => {
    try {
      dispatch(setAsupEnabled(true));
      await updateSettings({ enabled: true, consentGiven: true });
      notify.success("ASUP Metrics Sharing enabled");
    } catch (error) {
      notify.error("Failed to enable ASUP Metrics Sharing");
      console.error("Error enabling ASUP:", error);
    }
    setConfirmModalType(null);
  }, [dispatch, updateSettings]);

  // Handle confirm disable
  const handleConfirmDisable = useCallback(async () => {
    try {
      dispatch(setAsupEnabled(false));
      await updateSettings({ enabled: false, consentGiven: true });
      notify.info("ASUP Metrics Sharing disabled");
    } catch (error) {
      notify.error("Failed to disable ASUP Metrics Sharing");
      console.error("Error disabling ASUP:", error);
    }
    setConfirmModalType(null);
  }, [dispatch, updateSettings]);

  // Handle cancel confirmation
  const handleCancelConfirm = useCallback(() => {
    setConfirmModalType(null);
  }, []);

  // Manually trigger transmission
  const handleManualTransmit = useCallback(async () => {
    try {
      const result = await triggerTransmission().unwrap();
      if (result.success) {
        notify.success("ASUP data transmitted successfully");
      } else {
        notify.error(result.message || "Transmission failed");
      }
    } catch (error) {
      notify.error("Failed to transmit ASUP data");
      console.error(error);
    }
  }, [triggerTransmission]);

  return (
    <Box className="flex flex-col gap-6">
      {/* Header Section */}
      <Box>
        <Text className="text-lg font-semibold mb-2">
          AutoSupport (ASUP) Metrics Sharing
        </Text>
        <Text className="text-sm text-gray-600">
          Share anonymized migration metrics with NetApp to help improve NDM.
        </Text>
      </Box>

      {/* Toggle Section */}
      <Box className="flex flex-row justify-between items-center p-4 bg-slate-50 rounded-lg">
        <Box>
          <Box className="flex items-center gap-2">
            <Text className="font-medium">Enable ASUP Metrics Sharing</Text>
            {!isAppAdmin && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">(View only)</span>
            )}
          </Box>
          <Text className="text-sm text-gray-500">
            {enabled ? "Currently sharing metrics with NetApp" : "Metrics sharing is disabled"}
          </Text>
          {!isAppAdmin && (
            <Text className="text-xs text-amber-600 mt-1">
              Only App Admins can modify this setting
            </Text>
          )}
        </Box>
        <Toggle
          value={enabled}
          toggle={handleToggle}
          disabled={!isAppAdmin}
        />
      </Box>

      {/* Data Collection Info */}
      <Box className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <Text className="font-semibold text-blue-800 mb-2">
          What data is collected?
        </Text>
        <ul className="list-disc list-inside text-blue-700 text-sm space-y-1">
          <li>Project and job configuration identifiers</li>
          <li>Job types (discovery, migration, cutover)</li>
          <li>File counts and total sizes migrated</li>
          <li>Job run counts and success rates</li>
          <li>Source and destination storage types</li>
          <li>Migration protocols used (SMB, NFS)</li>
        </ul>
      </Box>

      {/* What is NOT collected */}
      <Box className="bg-gray-50 p-4 rounded-lg border border-gray-200">
        <Text className="font-semibold text-gray-800 mb-2">
          What is NOT collected?
        </Text>
        <ul className="list-disc list-inside text-gray-600 text-sm space-y-1">
          <li>File names or contents</li>
          <li>User credentials or passwords</li>
          <li>IP addresses or hostnames</li>
          <li>Personal or sensitive business data</li>
        </ul>
      </Box>

      {/* Metrics Preview (only when enabled) */}
      {enabled && (
        <Box className="border rounded-lg p-4">
          <Text className="font-semibold mb-2">Current Metrics Summary</Text>
          {isLoadingMetrics ? (
            <Text className="text-gray-500">Loading metrics...</Text>
          ) : metricsData ? (
            <Box className="text-sm space-y-1">
              <Text>Projects: {metricsData.projects?.length || 0}</Text>
              <Text>
                Total Jobs:{" "}
                {metricsData.projects?.reduce((sum, p) => sum + (p.jobs?.length || 0), 0) || 0}
              </Text>
              <Text>Schema Version: {metricsData.schemaVersion}</Text>
            </Box>
          ) : (
            <Text className="text-gray-500">No metrics data available</Text>
          )}
        </Box>
      )}

      {/* Last Transmission */}
      {lastTransmission && (
        <Box className="text-sm text-gray-500">
          Last transmission: {new Date(lastTransmission).toLocaleString()}
        </Box>
      )}

      {/* Manual Transmit Button (only for App Admin when enabled) */}
      {enabled && isAppAdmin && (
        <Box className="mt-4">
          <Button
            variant="secondary"
            onClick={handleManualTransmit}
            disabled={isTransmitting}
          >
            {isTransmitting ? "Transmitting..." : "Transmit Now"}
          </Button>
          <Text className="text-xs text-gray-400 mt-1">
            ASUP data is automatically transmitted weekly
          </Text>
        </Box>
      )}

      {/* Confirmation Modal for enable */}
      {confirmModalType === "enable" && (
        <Modal>
          <ModalHeader>Enable ASUP Metrics Sharing</ModalHeader>
          <ModalContent>
            <Box className="space-y-4">
              <p className="text-gray-600">
                Are you sure you want to enable ASUP Metrics Sharing?
              </p>
              <p className="text-gray-600">
                This will allow NetApp to collect anonymous usage metrics to help
                improve the Data Migrator service. No personally identifiable
                information will be collected.
              </p>
            </Box>
          </ModalContent>
          <ModalFooter>
            <Button color="secondary" onClick={handleCancelConfirm}>
              Cancel
            </Button>
            <Button onClick={handleConfirmEnable}>
              Enable
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Confirmation Modal for disable */}
      {confirmModalType === "disable" && (
        <Modal>
          <ModalHeader>Disable ASUP Metrics Sharing</ModalHeader>
          <ModalContent>
            <Box className="space-y-4">
              <p className="text-gray-600">
                Are you sure you want to disable ASUP Metrics Sharing?
              </p>
              <p className="text-gray-600">
                Disabling this will stop the collection and transmission of
                anonymous usage metrics to NetApp. You can re-enable it at any time.
              </p>
            </Box>
          </ModalContent>
          <ModalFooter>
            <Button color="secondary" onClick={handleCancelConfirm}>
              Cancel
            </Button>
            <Button color="primary" onClick={handleConfirmDisable}>
              Disable
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </Box>
  );
};

export default AsupMetricsContent;
