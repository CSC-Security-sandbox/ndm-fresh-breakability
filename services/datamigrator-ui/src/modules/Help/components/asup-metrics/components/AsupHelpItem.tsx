import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Toggle } from "@netapp/bxp-design-system-react";
import { RootStateType } from "@store/store";
import {
  setAsupEnabled,
  openConsentModal,
} from "@store/reducer/asupSlice";
import { useUpdateAsupSettingsMutation } from "@api/asupApi";
import { notify } from "@components/notification/NotificationWrapper";
import Box from "@/components/container/Box";
import { HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";
import AsupConsentModal from "@modules/Help/components/asup-metrics/components/AsupConsentModal";

interface AsupHelpItemProps {
  onItemClick: (id: number) => void;
  itemId: number;
}

const AsupHelpItem = ({ onItemClick, itemId }: AsupHelpItemProps) => {
  const dispatch = useDispatch();
  const { enabled, consentGiven } = useSelector(
    (state: RootStateType) => state.asupSlice
  );
  const [updateSettings] = useUpdateAsupSettingsMutation();

  // Handle toggle click
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
    },
    [enabled, consentGiven, dispatch, updateSettings]
  );

  // Handle row click to show settings
  const handleRowClick = useCallback(() => {
    onItemClick(itemId);
  }, [onItemClick, itemId]);

  return (
    <>
      <Box
        className="flex flex-row justify-between items-center p-3 border-b cursor-pointer hover:bg-slate-100 hover:text-text-title transition-all duration-100"
        onClick={handleRowClick}
      >
        <span>{HELP_ITEMS_ENUM.ASUP_METRICS_SHARING}</span>
        <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <Toggle
            value={enabled}
            toggle={handleToggle}
            disabled={false}
          />
        </Box>
      </Box>
      <AsupConsentModal />
    </>
  );
};

export default AsupHelpItem;
