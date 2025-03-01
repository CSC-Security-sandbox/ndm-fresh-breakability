import "@netapp/bxp-design-system-react/dist/index.css";
import { Route, Routes } from "react-router-dom";
import FileServer from "./pages/FileServerPage";
import Home from "./pages/Home";
import SpeedTest from "./pages/SpeedTest";
import HomeLayout from "./components/route-layout/HomeLayout";
import NotFound from "./components/404/PageNotFound";
import FileServerPage from "./pages/FileServerPage";
import FileServerOverView from "@/modules/storage-servers/file-server/file-server-overview/FileServerOverView";
import CreateNewFileServer from "./modules/storage-servers/file-server/new-file-server/CreateNewFileServer";
import { FormFieldSelect, useForm } from "@netapp/bxp-design-system-react";

const App = () => {
  const form = useForm({ name: "" });
  const options = [
    { label: "Label all alone", value: 1 },
    {
      label: "Label with sub-label: ",
      value: 2,
      subLabel: "I'm the sub-label",
    },
    { label: "Label with tag", value: 7, tag: "Some Tag Text" },
    {
      label: "Label with secondary label",
      value: 3,
      secondaryLabel: "Secondary Label",
    },
    { label: "Label with tooltip", value: 4, tooltip: "tool tip" },
    { label: "Disabled Option", value: 5, isDisabled: true },
    {
      label: "Disabled Option with tooltip",
      value: 6,
      isDisabled: true,
      tooltip: "tool tip",
    },
  ];

  return (
    <div className="">
      <FormFieldSelect
        label="Account"
        name="name"
        form={form}
        options={options}
      />
      {/* <Routes>
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

          <Route path="workers" element={<SpeedTest />} />
          <Route path="job" element={<FileServer />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes> */}
    </div>
  );
};

export default App;
