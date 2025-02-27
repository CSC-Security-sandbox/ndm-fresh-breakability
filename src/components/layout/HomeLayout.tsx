import { Outlet } from "react-router-dom";
import SideBar from "../sideBar/SideBar";
import TabHeaderWrapper from "../tab-header-wrapper/TabHeaderWrapper";

const HomeLayout = () => {
  return (
    <div className="flex h-screen overflow-hidden">
      <SideBar />
      <div className="w-full">
        <TabHeaderWrapper />
        <Outlet />
      </div>
    </div>
  );
};

export default HomeLayout;
