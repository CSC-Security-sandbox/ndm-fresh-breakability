import { useMemo, useState } from "react";
import {
  Button,
  WizardFooter,
  Card,
  Text,
} from "@netapp/bxp-design-system-react";
import { notify } from "@components/notification/NotificationWrapper";
import { useAuth } from "react-oidc-context";
import { Box } from "@components/container/index";
import EmptyNavBar from "@modules/create-first-project/components/EmptyNavBar";
import { useDispatch } from "react-redux";
import { clearAuth } from "@store/reducer/authSlice";

const NoProjects = () => {
  const auth = useAuth();
  const dispatch = useDispatch();
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const getSessionData = () => {
    try {
      const sessionKey = window?.env?.VITE_SESSION_KEY || import.meta.env.VITE_SESSION_KEY || "";
      return JSON.parse(
        sessionStorage.getItem(sessionKey) || "{}"
      );
    } catch (error) {
      console.error("Failed to parse session data:", error);
      return {};
    }
  }
  const sessionData = useMemo(() => getSessionData(), []);
  const username = sessionData?.profile?.name || '';

  const logout = async () => {
    setIsLoading(true);
    try {
      await auth.signoutSilent();
      dispatch(clearAuth());
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
      <Box className="p-10">
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
        <WizardFooter className="" style={{}}>
          <Button
            onClick={logout}
            isSubmitting={isLoading}
          >
            Logout
          </Button>
        </WizardFooter>
      </Box>
    </>
  );
};

export default NoProjects;