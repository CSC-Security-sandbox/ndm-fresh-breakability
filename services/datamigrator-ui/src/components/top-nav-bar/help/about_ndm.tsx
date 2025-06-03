import Box from "@/components/container/Box";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification"
import {
  Button,
  Card,
  Layout, Text, WizardFooter,
  WizardHeader
} from "@netapp/bxp-design-system-react";
import React from "react";

const AboutNDM = ({ closeAction}) => {
  const handleClose = () => {
    closeAction();
  };
  return (
    <Card className="h-full w-[40rem]">
      <Layout.Page>
        <WizardHeader Icon={InfoIcon} label="About NDM" />
        <Layout.Content className="p-10">
          <Card className="p-10 flex flex-col gap-6">
            <Box className="p-10 flex flex-col gap-2">
              <Box className="flex gap-4">
                <Text><b>Builder Version:</b> 2025.06.03-alpha</Text>
              </Box>
              <Box className="flex gap-4">
                <Text><b>Contact Us:</b> <u className="text-blue-500">niharika@netapp.com</u></Text>
              </Box>
            </Box>
          </Card>
          <WizardFooter className="" style={{}}>
            <Box className="flex w-full justify-end gap-4 mr-4">
              <Button
                style={{ width: 150 }}
                color="secondary"
                onClick={handleClose}
              >
                Cancel
              </Button>
            </Box>
          </WizardFooter>
        </Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default AboutNDM;
