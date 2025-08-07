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
// import { useLogoutUserMutation } from "@api/userApi";
import Cookies from "js-cookie";
import { notify } from "@components/notification/NotificationWrapper";
import { useAuth } from "react-oidc-context";
import ThemeToggler from "@/components/theme-toggler/ThemeToggler";
const UserDetailsContent = () => {
  const auth = useAuth();

  //TODO: Copy the session data to redux and access from there.
  const sessionData = JSON.parse(
    sessionStorage.getItem(
      window?.env?.VITE_SESSION_KEY || import.meta.env.VITE_SESSION_KEY || ""
    ) || "{}"
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);

  // const [logoutUser] = useLogoutUserMutation();
  const form = useForm({ email: sessionData?.profile?.email });

  const logout = async () => {
    setIsLoading(true);
    try {
      //TODO : check if this is not needed, then delete this and remove the logout api
      // const refresh_token = Cookies.get("refresh_token");
      // const client_id = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;
      // const client_secret = import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;

      // if (!refresh_token || !client_id || !client_secret) {
      //   console.error("Required parameters for logout are missing.");
      // }

      // const body = {
      //   refresh_token,
      //   client_id,
      //   client_secret,
      // };

      // await logoutUser(body).unwrap();
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
    <Layout.Page>
      <WizardHeader
        Icon={UserIcon}
        label="User Settings"
        logo={null}
        children={null}
        onClose={() => {}}
        closeLink=""
        Widgets={null}
      />
      <Layout.Content style={{ padding: 40 }}>
        <FormFieldInputNew form={form} name="email" label="Email ID" readOnly />
        <div style={{ marginTop: 20 }}>
          <ThemeToggler />
        </div>
      </Layout.Content>
      <WizardFooter className="" style={{}}>
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
