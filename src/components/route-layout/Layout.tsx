import { useGetAllProjectsQuery } from "@api/projectApi";
import { Box } from "@components/container";
import SideBar from "@components/sideBar/SideBar";
import TabHeaderWrapper from "@components/tab-header-wrapper/TabHeaderWrapper";
import TopNavBar from "@components/top-nav-bar/TopNavBar";
import useAccountDetails from "@hooks/useAccountDetails";
import CreateFirstProject from "@modules/create-first-project/CreateFirstProject";
import { Outlet } from "react-router-dom";

const Layout = () => {
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
          <Box className="relative flex overflow-hidden h-[calc(100vh-5rem)]">
            <SideBar />
            <Box className="relative left-[5rem] w-[calc(100vw-5rem)] bg-content-bg overflow-y-auto">
              <TabHeaderWrapper />
              <Outlet />
              <Box
                id="step-footer"
                className="fixed bottom-0 h-[70px] w-full bg-inherit"
              ></Box>
            </Box>
          </Box>
        </>
      )}
    </>
  );
};

export default Layout;
