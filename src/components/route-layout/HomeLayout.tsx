import * as React from "react";
import { Outlet } from "react-router-dom";
import SideBar from "@components/sideBar/SideBar";
import TabHeaderWrapper from "@components/tab-header-wrapper/TabHeaderWrapper";
import TopNavBar from "@components/top-nav-bar/TopNavBar";
import { Box } from "@components/container";
import CreateFirstProject from "@modules/create-first-project/CreateFirstProject";
import useAccountDetails from "@hooks/useAccountDetails";;
import { useGetAllProjectsQuery } from "@api/projectApi";

const HomeLayout = () => {
  const { accountDetails } = useAccountDetails();
  const { data: projectList } = useGetAllProjectsQuery(accountDetails?.id);

  return (
    <>
      {!projectList || projectList?.length === 0 ? (
        <CreateFirstProject />
      ) : (
        <>
        {/* 5rem is the height of the header */}
          <TopNavBar />
          <Box className="flex overflow-hidden h-[calc(100vh-5rem)]">
            <SideBar />
            <Box className="w-full bg-content-bg overflow-y-auto">
              <TabHeaderWrapper />
              <Outlet />
            </Box>
          </Box>
        </>
      )}
    </>
  );
};

export default HomeLayout;
