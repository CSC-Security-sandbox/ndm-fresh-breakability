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
import CreateSMTP from "./SMTP/CreateSMTP";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import {
  useGetSmtpDetailsQuery,
} from "@api/userApi";
import {
  smtpValuesType,
} from "@/types/app.type";

const SettingsContent = () => {
  const [currentTab, setCurrentTab] = useState<number>(1);
  const { data: smtpData } = useGetSmtpDetailsQuery("");
  const [isEditSmtp, setIsEditSmtp] = useState<boolean>(false);
  const [smtpValues, setSmtpValues] = useState<smtpValuesType>({
                                                                SMTP_HOST: "",
                                                                SMTP_PORT: "",
                                                                SMTP_USER_NAME: "",
                                                                SMTP_PASSWORD: "",
                                                                SMTP_FROM_EMAIL: "",
                                                                SMTP_TO_EMAIL: "",
                                                              });

  const handleSmtp = () => {
    setCurrentTab(3);
    if (smtpData?.data?.SMTP?.length > 0) {
      smtpData.data.SMTP.forEach(item => {
        smtpValues[item.settingKey] = item.settingValue;
      });
      setSmtpValues(smtpValues);
      setIsEditSmtp(true);
    }
  }

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
            <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.SaveSmtp}>
              <InnerTab.Button
                isActive={currentTab === 3}
                onClick={() => {handleSmtp()}}
                style={{ paddingTop: 16, paddingBottom: 16 }}
              >
                <Span color="text-title">SMTP</Span>
              </InnerTab.Button>
            </PermissionAuth>
          </InnerTab>
        </WizardHeader>

        <Layout.Content>
          <TabPanel value={currentTab} index={1}>
            <ManageUsers />
          </TabPanel>
          <TabPanel value={currentTab} index={2}>
            <ManageProject />
          </TabPanel>
          <TabPanel value={currentTab} index={3}>
            <CreateSMTP isEditSmtp={isEditSmtp} smtpDetails={smtpValues}/>
          </TabPanel>
        </Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default SettingsContent;
