import { AppTemplateIcon } from "@netapp/bxp-design-system-react/icons/resources-services";
import { AppIcon, WorkspaceIcon } from "@netapp/bxp-style/react-icons/General";
import { MoveIcon } from "@netapp/bxp-style/react-icons/Action";
import { NoticeTriangleIcon } from "@netapp/bxp-style/react-icons/Notification";
import {
  GcpStorageIcon,
  VirtualMachineIcon,
} from "@netapp/bxp-style/react-icons/Storage";
import {
  BlueXpTabHeaderPropsType,
  HeaderType,
} from "@components/tab-header-wrapper/TabHeaderWrapper.interface";

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
      path: "/file-server",
      id: 0,
    },
  ],
};

const JOB_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: WorkspaceIcon,
  tabLabel: "Jobs",
  tabLinks: [
    {
      label: "Job Config List",
      path: "/jobs-list",
      id: 0,
    },
    {
      label: "Job Run List",
      path: "/jobs-run-list",
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

const JOB_ERRORS_HEADER_TAB: BlueXpTabHeaderPropsType = {
  tabIcon: NoticeTriangleIcon,
  tabLabel: "Errors",
  tabLinks: [],
};

export const HEADER_WITH_PATHNAME: HeaderType = {
  "/jobs-errors": JOB_ERRORS_HEADER_TAB,
  "/file-server": CONFIG_HEADER_TAB,
  "/new-file-server": CONFIG_HEADER_TAB,
  "/config/edit-file-server": CONFIG_HEADER_TAB,
  "/job": JOB_HEADER_TAB,
  "/reports": REPORTS_HEADER_TAB,
  "/workers": WORKERS_HEADER_TAB,
  "/home": HOME_HEADER_TAB, // MAKE SURE ITS LAST IN ARRAY
  "/speed-test": SPEED_TEST_HEADER_TAB,
  "/": HOME_HEADER_TAB,
  "/file-server/:fileServerId": CONFIG_HEADER_TAB,
  "/edit-file-server/:fileServerId": CONFIG_HEADER_TAB,
  "/file-server/:fileServerId/bulk-discover": CONFIG_HEADER_TAB,
  "/file-server/:fileServerId/bulk-migrate": CONFIG_HEADER_TAB,
  "/file-server/:fileServerId/bulk-cutover": CONFIG_HEADER_TAB,
  "/workers/:jobRunId": WORKERS_HEADER_TAB,
  "/jobs-list": JOB_HEADER_TAB,
  "/job-details/:jobId": JOB_HEADER_TAB,
  "/job-details/:jobId/errors": JOB_HEADER_TAB,
  "/job-details/:jobId/run/:jobRunId": JOB_HEADER_TAB,
  "/job-details/:jobId/run/:jobRunId/errors": JOB_HEADER_TAB,
  "/job-details/:jobId/run/:jobRunId/tasks": JOB_HEADER_TAB,
  "/jobs-run-list": JOB_HEADER_TAB,
  "/job-discovery-preview/:jobRunId": JOB_HEADER_TAB,
  "/speed-test/config": SPEED_TEST_HEADER_TAB,
  "/speed-test/:jobRunId": SPEED_TEST_HEADER_TAB,
};
