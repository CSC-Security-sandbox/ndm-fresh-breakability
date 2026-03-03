/* eslint-disable */
// @ts-nocheck
import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Toggle } from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import { setAsupEnabled } from "@store/reducer/asupSlice";
import { useUpdateAsupSettingsMutation } from "@api/asupApi";
import { notify } from "@components/notification/NotificationWrapper";
import Box from "@/components/container/Box";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";
import useIsAppAdmin from "@hooks/useIsAppAdmin";


const AsupHelpItem = () => {
  const dispatch = useDispatch();
  const { enabled } = useSelector((state: RootStateType) => state.asupSlice);
  const [updateSettings] = useUpdateAsupSettingsMutation();
  const isAppAdmin = useIsAppAdmin();

  // Handle toggle click - only App Admin can toggle
  const handleToggle = useCallback(async () => {
    if (!isAppAdmin) {
      notify.warning("Only App Admins can modify ASUP Metrics Sharing settings");
      return;
    }

    const newEnabledValue = !enabled;

    try {
      // Call the API first and wait for the result
      const result = await updateSettings({ enabled: newEnabledValue }).unwrap();
      
      // Only update state and show success after API succeeds
      dispatch(setAsupEnabled(newEnabledValue));
      
      if (newEnabledValue) {
        notify.success("AutoSupport Transmission has been enabled. Anonymous usage metrics will be shared to help us improve NetApp Data Migrator and provide better support.");
      } else {
        notify.info("AutoSupport Transmission has been disabled. Anonymous usage metrics will no longer be shared.");
      }
    } catch (error: any) {
      // Show appropriate error message
      const errorMessage = error?.data?.message || error?.message || "Failed to update ASUP Metrics Sharing settings";
      notify.error(errorMessage);
      console.error("Error updating ASUP:", error);
      // State was not changed, so no need to revert
    }
  }, [enabled, isAppAdmin, dispatch, updateSettings]);

  return (
    <Box
      className="flex flex-col p-3 border-b hover:bg-slate-100 hover:text-text-title transition-all duration-100"
    >
      <Box className="flex flex-row justify-between items-center">
        <Box className="flex items-center gap-2">
          <span>{HELP_ITEMS_ENUM.ASUP_METRICS_SHARING}</span>
          {!isAppAdmin && (
            <span className="text-xs text-gray-400">(View only)</span>
          )}
        </Box>
        <Box>
          <Toggle
            value={enabled}
            toggle={handleToggle}
            disabled={!isAppAdmin}
          />
        </Box>
      </Box>
      <Box className="text-xs text-gray-500 mt-1">
        Allow sharing usage metrics with NetApp to help improve NetApp Data Migrator.
      </Box>
    </Box>
  );
};

export default AsupHelpItem;
