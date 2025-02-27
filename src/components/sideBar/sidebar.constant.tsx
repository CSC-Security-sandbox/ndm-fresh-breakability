import { DocumentByolIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import {
  AppIcon,
  StatisticsIcon,
  WorkspaceIcon,
} from "@netapp/bxp-style/react-icons/General";
import { GcpStorageIcon } from "@netapp/bxp-style/react-icons/Storage";
import { CommunitiesIcon } from "@netapp/bxp-style/react-icons/General";
import { Box } from "../container";

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
        icon: (
          <GcpStorageIcon size="24" color="text-main-nav-icon-text-selected" />
        ),
        path: "/config/file-server",
      },
    ],
  },
  {
    id: "7",
    label: <Box className="text-sm font-semibold">Workers</Box>,
    icon: (
      <CommunitiesIcon size="24" color="text-main-nav-icon-text-selected" />
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
        label: "Job List",
        id: "31",
        icon: <></>,
        path: "/jobs/listing",
      },
      {
        label: "Job Run List",
        id: "32",
        icon: <></>,
        path: "/jobs/run",
      },
    ],
  },
  {
    id: "4",
    label: <Box className="text-sm font-semibold">Reports</Box>,
    icon: <StatisticsIcon size="24" color="text-main-nav-icon-text-selected" />,
    path: "/reports",
  },
];
