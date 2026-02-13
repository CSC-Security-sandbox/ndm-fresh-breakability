import AboutNDM from "@modules/Help/components/about-ndm/components/AboutNDM";
import React from "react";
import SupportBundle from "@modules/Help/components/support-bundle/SupportBundle";
import AsupMetricsSharing from "@modules/Help/components/asup-metrics/AsupMetricsSharing";

export enum HELP_ITEMS_ENUM {
  ABOUT_NDM = "About NDM",
  SUPPORT = "Support",
  DOCUMENTATION = "Documentation",
  FEEDBACK = "Feedback",
  SUPPORT_BUNDLE = "Support Bundle",
  ASUP_METRICS_SHARING = "ASUP Metrics Sharing",
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
    name: HELP_ITEMS_ENUM.FEEDBACK,
  },
  {
    id: 5,
    name: HELP_ITEMS_ENUM.SUPPORT_BUNDLE,
  },
  {
    id: 6,
    name: HELP_ITEMS_ENUM.ASUP_METRICS_SHARING,
  },
];

export const CONFIG_MAP = {
  1: { name: "AboutNDM", component: React.createElement(AboutNDM) },
  5: { name: "SupportBundle", component: React.createElement(SupportBundle) },
  6: { name: "AsupMetricsSharing", component: React.createElement(AsupMetricsSharing) },
};
