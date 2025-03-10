import React, { useState } from "react";
import { SettingsIcon } from "@netapp/bxp-style/react-icons/Action";
import {
  InnerTab,
  Span,
  Card,
  Layout,
  WizardHeader,
} from "@netapp/bxp-design-system-react";
import ManageProject from "./ManageProjects/ManageProjects";
import ManageUsers from "./ManageUsers/ManageUsers";

import Box from "@/components/container/Box";
import TabPanel from "@components/container/TabPanel";

const SettingsContent = () => {
  const [currentTab, setCurrentTab] = useState<number>(1);

  return (
    <Card className="h-full w-[70rem]">
      <Layout.Page>
        <WizardHeader
          label={
            <Box className="flex gap-0">
              <SettingsIcon />
              Settings
            </Box>
          }
        >
          <InnerTab>
            <InnerTab.Button
              isActive={currentTab === 1}
              onClick={() => setCurrentTab(1)}
              style={{ paddingTop: 16, paddingBottom: 16 }}
            >
              <Span color="text-title">Users</Span>
            </InnerTab.Button>
            <InnerTab.Button
              isActive={currentTab === 2}
              onClick={() => setCurrentTab(2)}
              style={{ paddingTop: 16, paddingBottom: 16 }}
            >
              <Span color="text-title">Projects</Span>
            </InnerTab.Button>
          </InnerTab>
        </WizardHeader>

        <Layout.Content>
          <TabPanel value={currentTab} index={1}>
            <ManageUsers />
          </TabPanel>
          <TabPanel value={currentTab} index={2}>
            <ManageProject />
          </TabPanel>
        </Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default SettingsContent;
