import "@netapp/bxp-design-system-react/dist/index.css";
import { Route, Routes } from "react-router-dom";
import "./App.css";
import FileServer from "./pages/FileServer";
import Home from "./pages/Home";
import SpeedTest from "./pages/SpeedTest";

import HomeLayout from "./components/layout/HomeLayout";
import NotFound from "./components/404/PageNotFound";
const App = () => {
  return (
    <div className="bg-main-background">
      <Routes>
        <Route path="/" element={<HomeLayout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/speed-test" element={<SpeedTest />} />
          <Route path="/workers" element={<SpeedTest />} />
          <Route path="/contact" element={<FileServer />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </div>
  );
};

export default App;
