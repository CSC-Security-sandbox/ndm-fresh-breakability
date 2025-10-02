import { useState } from "react";
import {
  InnerTab,
  Span,
  Card,
  Layout,
  TabHeader,
} from "@netapp/bxp-design-system-react";
import ManageProject from "@components/top-nav-bar/setting/ManageProjects/ManageProjects";
import ManageUsers from "@components/top-nav-bar/setting/ManageUsers/ManageUsers";

import Box from "@/components/container/Box";
import TabPanel from "@components/container/TabPanel";
import CreateSMTP from "@components/top-nav-bar/setting/SMTP/CreateSMTP";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { IAMIcon } from "@netapp/bxp-design-system-react/icons/monochrome";

const SettingsContent = () => {
  const [currentTab, setCurrentTab] = useState<number>(1);

  //making active tab should be users
  const handleDefaultTab = () => {
    setCurrentTab(1);
  };

  return (
    <Card className="h-full w-[70rem]">
      <Layout.Page>
        <TabHeader
          label={
            <Box className="flex gap-0">
              <IAMIcon />
              Settings
            </Box>
          }
        >
          <InnerTab>
            <PermissionAuth
              permissionName={USER_PERMISSION_TYPE_ENUM.ListUsers}
            >
              <InnerTab.Button
                isActive={currentTab === 1}
                onClick={() => setCurrentTab(1)}
                style={{ paddingTop: 16, paddingBottom: 16 }}
              >
                <Span color="text-title">Users</Span>
              </InnerTab.Button>
            </PermissionAuth>

            <PermissionAuth
              permissionName={USER_PERMISSION_TYPE_ENUM.ListProjects}
            >
              <InnerTab.Button
                isActive={currentTab === 2}
                onClick={() => setCurrentTab(2)}
                style={{ paddingTop: 16, paddingBottom: 16 }}
              >
                <Span color="text-title">Projects</Span>
              </InnerTab.Button>
            </PermissionAuth>

            <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.SaveSmtp}>
              <InnerTab.Button
                isActive={currentTab === 3}
                onClick={() => setCurrentTab(3)}
                style={{ paddingTop: 16, paddingBottom: 16 }}
              >
                <Span color="text-title">SMTP</Span>
              </InnerTab.Button>
            </PermissionAuth>
          </InnerTab>
        </TabHeader>

        <Layout.Content>
          <TabPanel value={currentTab} index={1}>
            <ManageUsers />
          </TabPanel>
          <TabPanel value={currentTab} index={2}>
            <ManageProject />
          </TabPanel>
          <TabPanel value={currentTab} index={3}>
            <CreateSMTP handleDefaultTab={handleDefaultTab} />
          </TabPanel>
        </Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default SettingsContent;
