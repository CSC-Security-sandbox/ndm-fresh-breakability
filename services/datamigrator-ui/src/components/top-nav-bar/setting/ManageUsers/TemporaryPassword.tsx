import Box from "@/components/container/Box";
import { TemporaryPasswordPropsType } from "@/types/app.type";
import { copyToClipboard } from "@/utils/copyToClipboard";
import { Collapse } from "@mui/material";
import {
  Button,
  Card,
  FormFieldInputNew,
  Heading,
  Layout,
  Text,
  WizardFooter,
  Notification,
} from "@netapp/bxp-design-system-react";
import { useState } from "react";
import React from "react";

const TemporaryPassword = ({
  temporaryPassword,
  handlePasswordClose,
  isAddUser,
}: TemporaryPasswordPropsType) => {
  const [passwordCopiedNotification, setPasswordCopiedNotification] =
    useState(false);

  const copyToClipboardWrapper = () => {
    copyToClipboard(temporaryPassword);
    setPasswordCopiedNotification(true);
  };

  return (
    <Layout.Content>
      <Card>
        <Box className="p-8 flex flex-col gap-4">
          <Collapse in={passwordCopiedNotification} mountOnEnter unmountOnExit>
            <Notification
              type="success"
              onClose={() => {
                setPasswordCopiedNotification(false);
              }}
            >
              Password copied to clipboard
            </Notification>
          </Collapse>
          <Heading level="20">
            {isAddUser
              ? "User Added Successfully"
              : "Password Reset Successfully"}
          </Heading>
          <Box>
            <Text>
              Here is a temporary password that can be copied and shared with
              end user.
            </Text>
          </Box>
          <Box className="w-5/6 flex items-center gap-4">
            <FormFieldInputNew
              value={temporaryPassword}
              type="password"
              name="password"
              label="Password"
            />
            <Box
              className="text-text-title underline cursor-pointer"
              onClick={copyToClipboardWrapper}
            >
              Copy
            </Box>
          </Box>
        </Box>
      </Card>
      <WizardFooter>
        <Box className="flex w-full justify-end gap-4 mr-4">
          <Button onClick={handlePasswordClose}>Close</Button>
        </Box>
      </WizardFooter>
    </Layout.Content>
  );
};

export default TemporaryPassword;
