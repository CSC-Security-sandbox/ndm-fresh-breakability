"use client";
import { AuthProvider } from "react-oidc-context";
import React from "react";

const onSigninCallback = (): void => {
  window.history.replaceState({}, document.title, window.location.pathname);
};

const oidcConfig = {
  authority: import.meta.env.VITE_PUBLIC_KEYCLOAK_AUTHORITY || "",
  grant_type: import.meta.env.VITE_PUBLIC_KEYCLOAK_GRANT_TYPE || "",
  client_id: import.meta.env.VITE_PUBLIC_KEYCLOAK_CLIENT_ID || "",
  client_secret: import.meta.env.VITE_PUBLIC_KEYCLOAK_CLIENT_SECRET || "",
  redirect_uri: import.meta.env.VITE_PUBLIC_KEYCLOAK_REDIRECT_URI || "",
  response_type: import.meta.env.VITE_PUBLIC_KEYCLOAK_RESPONSE_TYPE || "",
  postLogoutRedirectUri:
    import.meta.env.VITE_PUBLIC_KEYCLOAK_POST_LOGOUT_REDIRECT_URI || "",
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
