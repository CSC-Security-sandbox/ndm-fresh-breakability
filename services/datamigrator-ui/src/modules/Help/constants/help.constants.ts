import AboutNDM from "@modules/Help/components/about-ndm/components/AboutNDM";
import React from "react";
import SupportBundle from "@modules/Help/components/support-bundle/SupportBundle";
import Upgrade from "@modules/Help/components/upgrade/upgrade";

export enum HELP_ITEMS_ENUM {
  ABOUT_NDM = "About NDM",
  SUPPORT = "Support",
  DOCUMENTATION = "Documentation",
  SUPPORT_BUNDLE = "Support Bundle",
  UPGRADE = "Upgrade",
  ASUP_METRICS_SHARING = "Telemetry Transmission",
}

export const HELP_ITEMS = [
  {
    id: 1,
    name: HELP_ITEMS_ENUM.ABOUT_NDM,
  },
  {
    id: 2,
    name: HELP_ITEMS_ENUM.SUPPORT,
  },
  {
    id: 3,
    name: HELP_ITEMS_ENUM.DOCUMENTATION,
  },
  {
    id: 4,
    name: HELP_ITEMS_ENUM.SUPPORT_BUNDLE,
  },
  {
    id: 5,
    name: HELP_ITEMS_ENUM.UPGRADE
  },
  {
    id: 6,
    name: HELP_ITEMS_ENUM.ASUP_METRICS_SHARING,
  },
];

export const CONFIG_MAP = {
  1: { name: "AboutNDM", component: React.createElement(AboutNDM) },
  // 2: Support- opens an external URL in a new tab
  // 3: Documentation - opens an external URL in a new tab
  4: { name: "SupportBundle", component: React.createElement(SupportBundle) },
  5: { name: "Upgrade", component: React.createElement(Upgrade) },
  // 6: ASUP Metrics Sharing is not clickable - only shows a toggle in the list
};
