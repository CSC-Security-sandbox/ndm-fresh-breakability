import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Button,
  Toggle,
  Text,
} from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import {
  setAsupEnabled,
  openConsentModal,
} from "@store/reducer/asupSlice";
import {
  useUpdateAsupSettingsMutation,
  useGetMigrationAnalysisQuery,
  useTriggerAsupTransmissionMutation,
} from "@api/asupApi";
import { notify } from "@components/notification/NotificationWrapper";
import Box from "@/components/container/Box";

/**
 * AsupMetricsContent displays the ASUP settings and metrics preview
 * within the Help drawer.
 */
const AsupMetricsContent = () => {
  const dispatch = useDispatch();
  const { enabled, consentGiven, lastTransmission } = useSelector(
    (state: RootStateType) => state.asupSlice
  );
  const [updateSettings] = useUpdateAsupSettingsMutation();
  const [triggerTransmission, { isLoading: isTransmitting }] = useTriggerAsupTransmissionMutation();
  const { data: metricsData, isLoading: isLoadingMetrics } = useGetMigrationAnalysisQuery(undefined, {
    skip: !enabled,
  });

  // Handle toggle for enabling/disabling ASUP
  const handleToggle = useCallback(() => {
    if (!enabled) {
      // If enabling, need to check if consent was given
      if (!consentGiven) {
        // Show consent modal
        dispatch(openConsentModal());
      } else {
        // Consent was already given, just enable
        dispatch(setAsupEnabled(true));
        updateSettings({ enabled: true, consentGiven: true });
        notify.success("ASUP Metrics Sharing enabled");
      }
    } else {
      // Disabling
      dispatch(setAsupEnabled(false));
      updateSettings({ enabled: false });
      notify.info("ASUP Metrics Sharing disabled");
    }
  }, [enabled, consentGiven, dispatch, updateSettings]);

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
          <Text className="font-medium">Enable ASUP Metrics Sharing</Text>
          <Text className="text-sm text-gray-500">
            {enabled ? "Currently sharing metrics with NetApp" : "Metrics sharing is disabled"}
          </Text>
        </Box>
        <Toggle
          value={enabled}
          toggle={handleToggle}
          disabled={false}
        />
      </Box>

      {/* Consent Status */}
      <Box className={`p-4 rounded-lg ${consentGiven ? "bg-green-50 border border-green-200" : "bg-yellow-50 border border-yellow-200"}`}>
        <Text className={`font-medium ${consentGiven ? "text-green-800" : "text-yellow-800"}`}>
          Consent Status: {consentGiven ? "Granted" : "Not Granted"}
        </Text>
        <Text className={`text-sm ${consentGiven ? "text-green-600" : "text-yellow-600"}`}>
          {consentGiven
            ? "You have agreed to share anonymized metrics with NetApp."
            : "Enable ASUP to provide consent for data sharing."}
        </Text>
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

      {/* Manual Transmit Button (for testing) */}
      {enabled && consentGiven && (
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
    </Box>
  );
};

export default AsupMetricsContent;
