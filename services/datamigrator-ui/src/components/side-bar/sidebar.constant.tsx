import { AppIcon, WorkspaceIcon } from "@netapp/bxp-style/react-icons/General";
import { MoveIcon } from "@netapp/bxp-style/react-icons/Action";
import {
  GcpStorageIcon,
  VirtualMachineIcon,
} from "@netapp/bxp-style/react-icons/Storage";
import { Box } from "@components/container/index";

export const MENU_ITEMS = [
  {
    id: "1",
    label: <Box className="text-sm font-semibold">Home</Box>,
    icon: <AppIcon size="24" color="text-main-nav-icon-text-selected" />,
    path: "/home",
  },
  {
    id: "2",
    label: <Box className="text-sm font-semibold">Storage Servers</Box>,
    path: "/config",
    icon: <GcpStorageIcon size="24" color="text-main-nav-icon-text-selected" />,
    subMenu: [
      {
        label: "File Servers",
        icon: <></>,
        path: "/file-server",
      },
    ],
  },
  {
    id: "7",
    label: <Box className="text-sm font-semibold">Workers</Box>,
    icon: (
      <VirtualMachineIcon size="24" color="text-main-nav-icon-text-selected" />
    ),
    path: "/workers",
  },
  {
    id: "3",
    label: <Box className="text-sm font-semibold">Jobs</Box>,
    icon: <WorkspaceIcon size="24" color="text-main-nav-icon-text-selected" />,
    path: "/jobs",
    subMenu: [
      {
        label: "Job Config List",
        id: "31",
        icon: <></>,
        path: "/jobs-list",
      },
      {
        label: "Job Run List",
        id: "32",
        icon: <></>,
        path: "/jobs-run-list",
      },
    ],
  },
  // Commented this menu item as it is related to speed-test and not included in Alpha release.
  // When we decide to enable speed-test then uncomment this comment.
  /* {
    id: "4",
    label: <Box className="text-sm font-semibold">Speed Test</Box>,
    icon: <MoveIcon size="24" color="text-main-nav-icon-text-selected" />,
    path: "/speed-test",
  }, */
];
