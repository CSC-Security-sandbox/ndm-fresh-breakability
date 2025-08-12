import { useGetAllProjectsQuery } from "@api/projectApi";
import { Box } from "@components/container";
import SideBar from "@components/side-bar/SideBar";
import TabHeaderWrapper from "@components/tab-header-wrapper/TabHeaderWrapper";
import TopNavBar from "@components/top-nav-bar/TopNavBar";
import useAccountDetails from "@hooks/useAccountDetails";
import CreateFirstProject from "@modules/create-first-project/CreateFirstProject";
import { Outlet } from "react-router-dom";
import { Show } from "@components/show/Show";
import { Layout } from "@netapp/bxp-design-system-react";

const RootLayout = () => {
  const { accountDetails } = useAccountDetails();
  const { data: projectList } = useGetAllProjectsQuery(accountDetails?.id);

  return (
    <Show>
      <Show.When isTrue={!projectList || projectList?.length === 0}>
        <CreateFirstProject />
      </Show.When>
      <Show.Else>
        {/* 5rem is the height of the header */}
        <TopNavBar />
        <Box className="relative flex overflow-hidden h-[calc(100vh-5rem)]">
          <SideBar />
          <Layout.Content className="relative left-[5rem] w-[calc(100vw-5rem)] overflow-y-auto">
            <TabHeaderWrapper />
            <Outlet />
          </Layout.Content>
        </Box>
      </Show.Else>
    </Show>
  );
};

export default RootLayout;
