import * as React from "react";
import { Outlet } from "react-router-dom";
import SideBar from "@components/sideBar/SideBar";
import TabHeaderWrapper from "@components/tab-header-wrapper/TabHeaderWrapper";
import TopNavBar from "@components/top-nav-bar/TopNavBar";
import { Box } from "@components/container";

const HomeLayout = () => {
  return (
    <>
      <TopNavBar />
      <Box className="flex overflow-hidden h-[calc(100vh-5rem)]">
        <SideBar />
        <Box className="w-full bg-content-bg overflow-y-auto">
          {/* 5rem is the height of the header */}
          <TabHeaderWrapper />
          <Outlet />
        </Box>
      </Box>
    </>
  );
};

export default HomeLayout;
