import { useState, useEffect, useMemo } from "react";
import {
  createCountIndicator,
  createTreeSelectStyles,
  removeCountIndicator,
  TREE_SELECT_CONFIG,
} from "@modules/Help/components/support-bundle/styles/treeSelectStyles";

const updateCountIndicatorDisplay = (items: any[], maxVisible: number) => {
  if (items.length <= maxVisible) {
    removeCountIndicator(
      TREE_SELECT_CONFIG.TREE_SELECT_WRAPPER_CLASS,
      TREE_SELECT_CONFIG.COUNT_INDICATOR_CLASS
    );
    return;
  }

  createCountIndicator(
    TREE_SELECT_CONFIG.TREE_SELECT_WRAPPER_CLASS,
    TREE_SELECT_CONFIG.COUNT_INDICATOR_CLASS,
    items.length - maxVisible
  );
};

export const useTreeSelect = () => {
  const [selectedItems, setSelectedItems] = useState([]);

  const treeSelectStyles = useMemo(
    () =>
      createTreeSelectStyles(
        TREE_SELECT_CONFIG.TREE_SELECT_WRAPPER_CLASS,
        TREE_SELECT_CONFIG.MAX_VISIBLE_ITEMS
      ),
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      updateCountIndicatorDisplay(
        selectedItems,
        TREE_SELECT_CONFIG.MAX_VISIBLE_ITEMS
      );
    }, TREE_SELECT_CONFIG.TIMER_DELAY);

    return () => clearTimeout(timer);
  }, [selectedItems?.length]);

  const handleSelectionChange = (selectedValue: any) => {
    setSelectedItems(selectedValue || []);
  };

  return {
    selectedItems,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass: TREE_SELECT_CONFIG.TREE_SELECT_WRAPPER_CLASS,
  };
};
