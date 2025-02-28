"use client";
import { useState } from "react";
import { UserIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import {
  FormFieldInputNew,
  Button,
  useForm,
  Layout,
  WizardHeader,
  WizardFooter,
} from "@netapp/bxp-design-system-react";
// import { useRouter } from "nextjs-toploader/app";
import { useLogoutUserMutation } from "@api/userApi";
import Cookies from "js-cookie";
import { notify } from "@components/notification/NotificationWrapper";

const UserDetailsContent = () => {
  //TODO: Copy the session data to redux and access from there.
  const sessionData = JSON.parse(
    sessionStorage.getItem(import.meta.env.VITE_PUBLIC_SESSION_KEY || "") ||
      "{}"
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [logoutUser] = useLogoutUserMutation();
  const form = useForm({ email: sessionData?.profile?.email });
  // const router = useRouter();

  const logout = async () => {
    setIsLoading(true);
    try {
      const refresh_token = Cookies.get("refresh_token");
      const client_id = import.meta.env.VITE_PUBLIC_KEYCLOAK_CLIENT_ID;
      const client_secret = import.meta.env.VITE_PUBLIC_KEYCLOAK_CLIENT_SECRET;

      if (!refresh_token || !client_id || !client_secret) {
        console.error("Required parameters for logout are missing.");
      }

      const body = {
        refresh_token,
        client_id,
        client_secret,
      };

      await logoutUser(body).unwrap();
      Cookies.remove("access_token");
      Cookies.remove("refresh_token");
      sessionStorage.clear();
      // router.replace("/");
    } catch (error) {
      setIsLoading(false);
      notify.error("Something went wrong while logging out.");
      console.error("Something went wrong while doing logout:", error);
    }
  };

  return (
    <Layout.Page>
      <WizardHeader Icon={UserIcon} label="User Settings" />
      <Layout.Content
        style={{ padding: 40, backgroundColor: "var(--light-bg)" }}
      >
        <FormFieldInputNew form={form} name="email" label="Email ID" readOnly />
      </Layout.Content>
      <WizardFooter>
        <Button
          onClick={logout}
          isSubmitting={isLoading}
          className="flex flex-col gap-1"
        >
          Logout
        </Button>
      </WizardFooter>
    </Layout.Page>
  );
};

export default UserDetailsContent;
