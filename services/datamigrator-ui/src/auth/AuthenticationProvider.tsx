import { AuthProvider } from "react-oidc-context";
import React from "react";

const onSigninCallback = (): void => {
  window.history.replaceState({}, document.title, window.location.pathname);
};

const oidcConfig = {
  authority: window?.env?.VITE_KEYCLOAK_AUTHORITY || import.meta.env.VITE_KEYCLOAK_AUTHORITY || "",
  grant_type: window?.env?.VITE_KEYCLOAK_GRANT_TYPE || import.meta.env.VITE_KEYCLOAK_GRANT_TYPE || "",
  client_id: window?.env?.VITE_KEYCLOAK_CLIENT_ID || import.meta.env.VITE_KEYCLOAK_CLIENT_ID || "",
  client_secret: window?.env?.VITE_KEYCLOAK_CLIENT_SECRET || import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET || "",
  redirect_uri: window?.env?.VITE_KEYCLOAK_REDIRECT_URI || import.meta.env.VITE_KEYCLOAK_REDIRECT_URI || "",
  response_type: window?.env?.VITE_KEYCLOAK_RESPONSE_TYPE || import.meta.env.VITE_KEYCLOAK_RESPONSE_TYPE || "",
  postLogoutRedirectUri:
    window?.env?.VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI || import.meta.env.VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI || "",
  onSigninCallback,
};

const AuthenticationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return <AuthProvider {...oidcConfig}>{children}</AuthProvider>;
};

export default AuthenticationProvider;
