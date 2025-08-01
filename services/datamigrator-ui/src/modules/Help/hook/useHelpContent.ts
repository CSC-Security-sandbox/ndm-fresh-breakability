import { useContext, useEffect, useMemo } from "react";
import { useDrawerNavigation } from "@hooks/useDrawerNavigation";
import { CONFIG_MAP } from "@modules/Help/constants/help.constants";
import { HelpContext } from "@modules/Help/context/HelpContext";

export const useHelpContent = () => {
  const context = useContext(HelpContext);
  const { getItemIndex, setIsHelpListVisible } = context;

  const drawerConfig = useMemo(() => {
    return CONFIG_MAP[getItemIndex];
  }, [getItemIndex]);

  const { handleCloseDrawer } = useDrawerNavigation(
    drawerConfig?.name,
    drawerConfig?.component
  );

  const showSettings = () => {
    setIsHelpListVisible(false);
    handleCloseDrawer();
  };

  useEffect(() => {
    if (getItemIndex !== 0 && drawerConfig) {
      showSettings();
    }
  }, [getItemIndex, drawerConfig]);

  return {
    getItemIndex,
    drawerConfig,
    showSettings,
    setIsHelpListVisible,
  };
};
