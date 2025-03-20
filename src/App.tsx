import NotFound from "@components/404/PageNotFound";
import Layout from "@components/route-layout/Layout";
import "@netapp/bxp-design-system-react/dist/index.css";
import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";

// LAZY LOADED PAGES
const SpeedTestConfigPage = lazy(() => import("@pages/SpeedTestConfigPage"));
const JobTasksPage = lazy(() => import("@pages/JobTasksPage"));
const DiscoveryPreviewPage = lazy(() => import("@pages/DiscoveryPreviewPage"));
const WorkersPage = lazy(() => import("@pages/WorkersPage"));
const BulkCutOverPage = lazy(() => import("@pages/BulkCutOverPage"));
const BulkDiscoveryPage = lazy(() => import("@pages/BulkDiscoveryPage"));
const BulkMigratePage = lazy(() => import("@pages/BulkMigratePage"));
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

const App = () => {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="home" element={<HomePage />} />
          {/* FILE SERVER ROUTES */}
          <Route path="file-server" element={<FileServerPage />} />
          <Route
            path="file-server/:fileServerId"
            element={<FileServerOverViewPage />}
          />
          <Route path="new-file-server" element={<CreateNewFileServer />} />
          <Route
            path="edit-file-server/:fileServerId"
            element={<EditFileServerPage />}
          />
          {/* CREATE JOBS ROUTE */}
          <Route
            path="file-server/:fileServerId/bulk-discover"
            element={<BulkDiscoveryPage />}
          />
          <Route
            path="file-server/:fileServerId/bulk-migrate"
            element={<BulkMigratePage />}
          />
          <Route
            path="file-server/:fileServerId/bulk-cutover"
            element={<BulkCutOverPage />}
          />
          {/* WORKER */}
          <Route
            path="/job-details/:jobId/run/:jobRunId/workers"
            element={<WorkersPage />}
          />
          {/* JOBS ROUTES */}
          <Route path="jobs-list" element={<JobListPage />} />
          <Route path="job-details/:jobId" element={<JobDetailsPage />} />
          <Route
            path="job-details/:jobId/errors"
            element={<JobTaskErrorsPage />}
          />
          <Route
            path="/job-details/:jobId/run/:jobRunId"
            element={<JobRunDetailsPage />}
          />
          <Route
            path="/job-details/:jobId/run/:jobRunId/errors"
            element={<JobTaskErrorsPage />}
          />
          <Route
            path="/job-details/:jobId/run/:jobRunId/tasks"
            element={<JobTasksPage />}
          />
          <Route path="/jobs-run-list" element={<JobRunListPage />} />
          <Route
            path="/job-discovery-preview/:jobRunId"
            element={<DiscoveryPreviewPage />}
          />

          {/* SPEED TEST ROUTES */}
          <Route path="speed-test" element={<SpeedTestPage />} />
          <Route path="/speed-test/config" element={<SpeedTestConfigPage />} />
          <Route
            path="/speed-test/:jobRunId"
            element={<SpeedTestDetailsPage />}
          />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default App;
