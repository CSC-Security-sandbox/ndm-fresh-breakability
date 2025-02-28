import * as React from "react";

import { Outlet } from "react-router-dom";
import SideBar from "../sideBar/SideBar";
import TabHeaderWrapper from "../tab-header-wrapper/TabHeaderWrapper";
import TopNavBar from "../top-nav-bar/TopNavBar";
import { Box } from "../container";

const HomeLayout = () => {
  return (
    <Box>
      <TopNavBar />
      <div className="flex h-screen overflow-hidden">
        <SideBar />
        <div className="w-full">
          <TabHeaderWrapper />
          <Outlet />
        </div>
      </div>
    </Box>
  );
};

export default HomeLayout;
