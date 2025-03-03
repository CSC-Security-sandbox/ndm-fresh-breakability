import React, { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import "@netapp/bxp-design-system-react/dist/index.css";
import NotFound from "@components/404/PageNotFound";
import HomeLayout from "@components/route-layout/HomeLayout";
import RouteErrorBoundary from "@components/ErrorBoundary/ErrorBoundary";
import JobTasksPage from "@pages/JobTasksPage";

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

const App = () => {
  return (
    <div className="">
      <Suspense fallback={<div>Loading...</div>}>
        <Routes>
          <Route path="/" element={<HomeLayout />}>
            <Route index element={<HomePage />} />
            <Route path="home" element={<HomePage />} />
            {/* FILE SERVER ROUTES */}
            <Route path="config/file-server" element={<FileServerPage />} />
            <Route
              path="config/file-server/:fileServerId"
              element={<FileServerOverViewPage />}
            />
            <Route
              path="config/new-file-server"
              element={<CreateNewFileServer />}
            />
            <Route
              path="config/edit-file-server/:fileServerId"
              element={<EditFileServerPage />}
            />
            {/* CREATE JOBS ROUTE */}
            <Route
              path="config/file-server/:fileServerId/bulk-discover"
              element={<BulkDiscoveryPage />}
            />
            <Route
              path="config/file-server/:fileServerId/bulk-migrate"
              element={<BulkMigratePage />}
            />
            <Route
              path="config/file-server/:fileServerId/bulk-cutover"
              element={<BulkCutOverPage />}
            />
            {/* WORKER */}
            <Route path="workers" element={<WorkersPage />} />
            {/* JOBS ROUTES */}
            <Route path="jobs-list" element={<JobListPage />} />
            <Route path="job-details/:jobId" element={<JobDetailsPage />} />
            <Route
              path="/job-details/:jobId/run/:jobRunId"
              element={<JobRunDetailsPage />}
            />
            <Route
              path="/job-details/:jobId/run/:jobRunId/tasks"
              element={<JobTasksPage />}
            />

            <Route path="job-run-list" element={<JobRunListPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </div>
  );
};

export default App;
