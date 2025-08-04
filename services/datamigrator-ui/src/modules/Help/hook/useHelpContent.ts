import { useDrawerNavigation } from "@hooks/useDrawerNavigation";
import { CONFIG_MAP } from "@modules/Help/constants/help.constants";
import { HelpContext } from "@modules/Help/context/HelpContext";
import { useCallback, useContext, useEffect, useMemo } from "react";

export const useHelpContent = () => {
  const context = useContext(HelpContext);

  if (!context) {
    throw new Error("useHelpContent must be used within HelpProvider");
  }

  const { getItemIndex, setIsHelpListVisible } = context;

  const drawerConfig = useMemo(() => {
    return CONFIG_MAP[getItemIndex] || null;
  }, [getItemIndex]);

  const { handleCloseDrawer } = useDrawerNavigation(
    drawerConfig?.name,
    drawerConfig?.component
  );

  const showSettings = useCallback(() => {
    setIsHelpListVisible(false);
    handleCloseDrawer();
  }, [setIsHelpListVisible, handleCloseDrawer]);

  useEffect(() => {
    if (getItemIndex !== 0 && drawerConfig) {
      showSettings();
    }
  }, [getItemIndex, showSettings]);

  return useMemo(
    () => ({
      getItemIndex,
      drawerConfig,
      showSettings,
      setIsHelpListVisible,
    }),
    [getItemIndex, drawerConfig, showSettings, setIsHelpListVisible]
  );
};
