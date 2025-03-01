import "@netapp/bxp-design-system-react/dist/index.css";
import { Route, Routes } from "react-router-dom";
import FileServer from "./pages/FileServerPage";
import Home from "./pages/Home";
import HomeLayout from "./components/route-layout/HomeLayout";
import NotFound from "./components/404/PageNotFound";
import FileServerPage from "./pages/FileServerPage";
import FileServerOverView from "@/modules/storage-servers/file-server/file-server-overview/FileServerOverView";
import CreateNewFileServer from "./modules/storage-servers/file-server/new-file-server/CreateNewFileServer";
import WorkersPage from "@modules/workers/WorkersPage";

const App = () => {
  return (
    <div className="">
      <Routes>
        <Route path="/" element={<HomeLayout />}>
          <Route index element={<Home />} />
          <Route path="home" element={<Home />} />
          <Route path="config/file-server" element={<FileServerPage />} />
          <Route
            path="config/new-file-server"
            element={<CreateNewFileServer />}
          />
          <Route
            path="config/file-server/:fileServerId"
            element={<FileServerOverView />}
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
