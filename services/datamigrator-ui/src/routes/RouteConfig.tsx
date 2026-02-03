import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { lazy } from "react";
import NoAccess from "@components/403/NoAccess";
import NotFound from "@components/404/PageNotFound";
import { RouteConfigType } from "@routes/route-config.types";

// LAZY LOADED PAGES
const SpeedTestConfigPage = lazy(() => import("@pages/SpeedTestConfigPage"));
const JobTasksPage = lazy(() => import("@pages/JobTasksPage"));
const DiscoveryPreviewPage = lazy(() => import("@pages/DiscoveryPreviewPage"));
const WorkersPage = lazy(() => import("@pages/WorkersPage"));
const BulkCutOverPage = lazy(() => import("@pages/BulkCutOverPage"));
const BulkDiscoveryPage = lazy(() => import("@pages/BulkDiscoveryPage"));
const BulkMigratePage = lazy(() => import("@pages/BulkMigratePage"));
const ExploreExportPathsPage = lazy(() => import("@pages/ExploreExportPathsPage"));
const ExploreDirectoriesPage = lazy(() => import("@pages/ExploreDirectoriesPage"));
const FileServerOverViewPage = lazy(
  () => import("@pages/FileServerOverViewPage")
);
const HomePage = lazy(() => import("@pages/HomePage"));
const JobListPage = lazy(() => import("@pages/JobListPage"));
const CreateNewFileServer = lazy(
  () =>
    import(
      "@modules/storage-servers/file-server/new-file-server/CreateNewFileServer"
    )
);
const EditFileServerPage = lazy(() => import("@pages/EditFileServerPage"));
const FileServerPage = lazy(() => import("@pages/FileServerPage"));
const JobDetailsPage = lazy(() => import("@pages/JobDetailsPage"));
const JobRunDetailsPage = lazy(() => import("@pages/JobRunDetailsPage"));
const JobRunListPage = lazy(() => import("@pages/JobRunListPage"));
const SpeedTestPage = lazy(() => import("@pages/SpeedTestPage"));
const JobTaskErrorsPage = lazy(() => import("@pages/JobTaskErrorsPage"));
const SpeedTestDetailsPage = lazy(() => import("@pages/SpeedTestDetailsPage"));

export const routeConfig: RouteConfigType[] = [
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "home",
    element: <HomePage />,
  },
  {
    path: "file-server",
    element: <FileServerPage />,
  },
  {
    path: "file-server/:fileServerId",
    element: <FileServerOverViewPage />,
  },
  {
    path: "file-server/:fileServerId/explore",
    element: <ExploreExportPathsPage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageJob,
  },
  {
    path: "file-server/:fileServerId/explore-directories/:exportPathId",
    element: <ExploreDirectoriesPage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageJob,
  },
  {
    path: "new-file-server",
    element: <CreateNewFileServer />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageConfig,
  },
  {
    path: "edit-file-server/:fileServerId",
    element: <EditFileServerPage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageConfig,
  },
  {
    path: "file-server/:fileServerId/bulk-discover",
    element: <BulkDiscoveryPage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageJob,
  },
  {
    path: "file-server/:fileServerId/bulk-migrate",
    element: <BulkMigratePage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageJob,
  },
  {
    path: "file-server/:fileServerId/bulk-cutover",
    element: <BulkCutOverPage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageJob,
  },
  {
    path: "workers/:jobRunId?",
    element: <WorkersPage />,
  },
  {
    path: "jobs-list",
    element: <JobListPage />,
  },
  {
    path: "job-details/:jobId",
    element: <JobDetailsPage />,
  },
  {
    path: "job-details/:jobId/:jobRunId/errors",
    element: <JobTaskErrorsPage />,
  },
  {
    path: "job-details/:jobId/run/:jobRunId",
    element: <JobRunDetailsPage />,
  },
  {
    path: "job-details/:jobId/run/:jobRunId/errors",
    element: <JobTaskErrorsPage />,
  },
  {
    path: "job-details/:jobId/run/:jobRunId/tasks",
    element: <JobTasksPage />,
  },
  {
    path: "jobs-run-list",
    element: <JobRunListPage />,
  },
  {
    path: "job-discovery-preview/:jobRunId",
    element: <DiscoveryPreviewPage />,
  },
  /* Disable this routing of speed test as it is not included in Alpha release
    When we want to enable this routing then remove this comment and uncomment the commented code below */
  /*{
    path: "speed-test",
    element: <SpeedTestPage />,
  }, */
  {
    path: "speed-test/config",
    element: <SpeedTestConfigPage />,
    protected: true,
    requiredPermission: USER_PERMISSION_TYPE_ENUM.ManageJob,
  },
  {
    path: "speed-test/:jobRunId",
    element: <SpeedTestDetailsPage />,
  },
  {
    path: "no-access",
    element: <NoAccess />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
];
