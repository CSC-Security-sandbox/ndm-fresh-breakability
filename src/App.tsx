import "@netapp/bxp-design-system-react/dist/index.css";
import { Route, Routes } from "react-router-dom";
import FileServer from "./pages/FileServerPage";
import HomeLayout from "./components/route-layout/HomeLayout";
import NotFound from "./components/404/PageNotFound";
import FileServerPage from "./pages/FileServerPage";
import CreateNewFileServer from "./modules/storage-servers/file-server/new-file-server/CreateNewFileServer";
import WorkersPage from "@modules/workers/WorkersPage";
import FileServerOverViewPage from "@pages/FileServerOverViewPage";
import BulkCutOverPage from "@pages/BulkCutOverPage";
import BulkMigratePage from "@pages/BulkMigratePage";
import BulkDiscoveryPage from "@pages/BulkDiscoveryPage";
import HomePage from "./pages/HomePage";

const App = () => {
  return (
    <div className="">
      <Routes>
        <Route path="/" element={<HomeLayout />}>
          <Route index element={<HomePage />} />
          <Route path="home" element={<HomePage />} />
          <Route path="config/file-server" element={<FileServerPage />} />
          <Route
            path="config/new-file-server"
            element={<CreateNewFileServer />}
          />
          <Route
            path="config/file-server/:fileServerId"
            element={<FileServerOverViewPage />}
          />

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

          <Route path="workers" element={<WorkersPage />} />
          <Route path="job" element={<FileServer />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </div>
  );
};

export default App;
