/* eslint-disable */
// @ts-nocheck
import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Toggle,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Button,
} from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import { setAsupEnabled } from "@store/reducer/asupSlice";
import { useUpdateAsupSettingsMutation } from "@api/asupApi";
import { notify } from "@components/notification/NotificationWrapper";
import Box from "@/components/container/Box";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";
import useIsAppAdmin from "@hooks/useIsAppAdmin";

interface AsupHelpItemProps {
  onItemClick: (id: number) => void;
  itemId: number;
}

type ConfirmModalType = "enable" | "disable" | null;

/**
 * AsupHelpItem - Displays the ASUP Metrics Sharing toggle in the Help menu.
 *
 * - Shows the current ASUP enabled/disabled state
 * - Only App Admin can toggle (enable/disable)
 * - Project Admin and Project Viewer can only view the current state
 * - The initial state is set by the instance creator on the login profile page
 */
const AsupHelpItem = ({ onItemClick, itemId }: AsupHelpItemProps) => {
  const dispatch = useDispatch();
  const { enabled } = useSelector((state: RootStateType) => state.asupSlice);
  const [updateSettings] = useUpdateAsupSettingsMutation();
  const isAppAdmin = useIsAppAdmin();

  // State for confirmation modal
  const [confirmModalType, setConfirmModalType] = useState<ConfirmModalType>(
    null
  );

  // Handle toggle click - only App Admin can toggle
  const handleToggle = useCallback(() => {
    if (!isAppAdmin) {
      notify.warning("Only App Admins can modify ASUP Metrics Sharing settings");
      return;
    }

    // Show confirmation modal
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

  // Handle row click to show details
  const handleRowClick = useCallback(() => {
    onItemClick(itemId);
  }, [onItemClick, itemId]);

  return (
    <>
      <Box
        className="flex flex-row justify-between items-center p-3 border-b cursor-pointer hover:bg-slate-100 hover:text-text-title transition-all duration-100"
        onClick={handleRowClick}
      >
        <Box className="flex items-center gap-2">
          <span>{HELP_ITEMS_ENUM.ASUP_METRICS_SHARING}</span>
          {!isAppAdmin && (
            <span className="text-xs text-gray-400">(View only)</span>
          )}
        </Box>
        <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <Toggle
            value={enabled}
            toggle={handleToggle}
            disabled={!isAppAdmin}
          />
        </Box>
      </Box>

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
            <Button onClick={handleConfirmEnable}>Enable</Button>
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
    </>
  );
};

export default AsupHelpItem;
