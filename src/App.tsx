import WorkersPage from "@pages/WorkersPage";
import "@netapp/bxp-design-system-react/dist/index.css";
import BulkCutOverPage from "@pages/BulkCutOverPage";
import BulkDiscoveryPage from "@pages/BulkDiscoveryPage";
import BulkMigratePage from "@pages/BulkMigratePage";
import FileServerOverViewPage from "@pages/FileServerOverViewPage";
import HomePage from "@pages/HomePage";
import JobListPage from "@pages/JobListPage";
import { Route, Routes } from "react-router-dom";
import NotFound from "./components/404/PageNotFound";
import HomeLayout from "./components/route-layout/HomeLayout";
import CreateNewFileServer from "./modules/storage-servers/file-server/new-file-server/CreateNewFileServer";
import EditFileServerPage from "./pages/EditFileServerPage";
import FileServerPage from "./pages/FileServerPage";
import JobDetailsPage from "./pages/JobDetailsPage";
import JobRunDetailsPage from "./pages/JobRunDetailsPage";
import JobRunListPage from "./pages/JobRunListPage";

const App = () => {
  return (
    <div className="">
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
          <>
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
          </>
          {/* WORKER */}
          <Route path="workers" element={<WorkersPage />} />
          {/* JOBS ROUTES */}
          <Route path="jobs-list" element={<JobListPage />} />
          <Route path="job-details/:jobId" element={<JobDetailsPage />} />
          <Route
            path="/job-details/:jobId/run/:jobRunId"
            element={<JobRunDetailsPage />}
          />
          <Route path="job-run-list" element={<JobRunListPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </div>
  );
};

export default App;
