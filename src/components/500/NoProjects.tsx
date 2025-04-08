import { useState } from "react";
import {
  Button,
  WizardFooter,
} from "@netapp/bxp-design-system-react";
import Cookies from "js-cookie";
import { notify } from "@components/notification/NotificationWrapper";
import { useAuth } from "react-oidc-context";
import { Box } from "@components/container/index";
import { Card, Text } from "@netapp/bxp-design-system-react";
import EmptyNavBar from "@modules/create-first-project/components/EmptyNavBar";

const NoProjects = () => {
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const sessionData = JSON.parse(
    sessionStorage.getItem(window?.env?.VITE_SESSION_KEY || import.meta.env.VITE_SESSION_KEY || "") || "{}"
  );
  const username = sessionData?.profile?.name ? sessionData?.profile?.name : '';

  const logout = async () => {
    setIsLoading(true);
    try {
      await auth.signoutSilent();
      Cookies.remove("access_token");
      Cookies.remove("refresh_token");
      sessionStorage.clear();
    } catch (error) {
      setIsLoading(false);
      notify.error("Something went wrong while logging out.");
      console.error("Something went wrong while doing logout:", error);
    }
  };


  return (
    <>
    <EmptyNavBar />
      <Box className="items-center justify-center p-10">
        <Card className="flex flex-col gap-5 items-center p-8">
          <Box className="font-semibold text-xl">No Access</Box>
            <Text className="text-center w-[55rem]">
              Dear <b>{username}</b>, It appears that you currently do not have any active projects linked to access the NDM.
              If you would like to create or link a project, please get in touch with our support team or your administrator for assistance.
            </Text>
            <Text>
              Thank you for your understanding.
            </Text>
        </Card>
        <WizardFooter>
          <Button
            onClick={logout}
            isSubmitting={isLoading}
            className="flex flex-col gap-1"
          >
            Logout
          </Button>
        </WizardFooter>
      </Box>
    </>
  );
};

export default NoProjects;