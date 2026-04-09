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
import { notify } from "@components/notification/NotificationWrapper";
import { useAuth } from "react-oidc-context";
import { useDispatch } from "react-redux";
import { clearAuth } from "@store/reducer/authSlice";
const UserDetailsContent = () => {
  const auth = useAuth();
  const dispatch = useDispatch();

  //TODO: Copy the session data to redux and access from there.
  const sessionData = JSON.parse(
    sessionStorage.getItem(window?.env?.VITE_SESSION_KEY || import.meta.env.VITE_SESSION_KEY || "") || "{}"
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);

  // const [logoutUser] = useLogoutUserMutation();
  const form = useForm({ email: sessionData?.profile?.email });

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
