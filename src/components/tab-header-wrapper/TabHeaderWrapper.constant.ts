import { AppTemplateIcon } from "@netapp/bxp-design-system-react/icons/resources-services";
import { AppIcon, WorkspaceIcon } from "@netapp/bxp-style/react-icons/General";
import { MoveIcon } from "@netapp/bxp-style/react-icons/Action";

import {
  GcpStorageIcon,
  VirtualMachineIcon,
} from "@netapp/bxp-style/react-icons/Storage";
import {
  BlueXpTabHeaderPropsType,
  HeaderType,
} from "./TabHeaderWrapper.interface";

const HOME_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: AppIcon,
  tabLabel: "Home",
  tabLinks: [],
};

const CONFIG_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: GcpStorageIcon,
  tabLabel: "Storage Servers",
  tabLinks: [
    {
      label: "File Servers",
      path: "/config/file-server",
      id: 0,
    },
  ],
};

const JOB_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: WorkspaceIcon,
  tabLabel: "Jobs",
  tabLinks: [
    {
      label: "Job List",
      path: "/jobs-list",
      id: 0,
    },
    {
      label: "Job Run List",
      path: "/job-run-list",
      id: 1,
    },
  ],
};

const REPORTS_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: AppTemplateIcon,
  tabLabel: "Reports",
  tabLinks: [],
};

const WORKERS_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: VirtualMachineIcon,
  tabLabel: "Workers",
  tabLinks: [],
};

const SPEED_TEST_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: MoveIcon,
  tabLabel: "Speed Test",
  tabLinks: [],
};

export const HEADER_WITH_PATHNAME: HeaderType = {
  "/config/file-server": CONFIG_HEADER_TAB,
  "/new-file-server": CONFIG_HEADER_TAB,
  "/config/edit-file-server": CONFIG_HEADER_TAB,
  "/job": JOB_HEADER_TAB,
  "/reports": REPORTS_HEADER_TAB,
  "/workers": WORKERS_HEADER_TAB,
  "/home": HOME_HEADER_TAB, // MAKE SURE ITS LAST IN ARRAY
  "/speed-test": SPEED_TEST_HEADER_TAB,
};
