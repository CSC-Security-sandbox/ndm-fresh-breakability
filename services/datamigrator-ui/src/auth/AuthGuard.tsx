/* eslint-disable @typescript-eslint/no-explicit-any */
import Cookies from 'js-cookie';
import {useEffect, useRef, useState} from 'react';
import {useAuth} from 'react-oidc-context';
import {useDispatch} from 'react-redux';
import {setUserPermissions} from '@store/reducer/permissionSlice';
import {useLazyGetUserPermissionsQuery} from '@api/permissionApi';
import useAccountDetails from '@hooks/useAccountDetails';
import {useLazyGetAllProjectsQuery} from '@api/projectApi';
import {setAllProjectList, setProject} from '@store/reducer/appSlice';
import {useRefreshUserTokenMutation} from '@api/userApi';
import {notify} from '@components/notification/NotificationWrapper';
import {ProjectApiType} from '@/types/app.type';
import {useLazyGetAllAccountsQuery} from '@api/accountApi';
import NoProjects from '@components/500/NoProjects';

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const auth = useAuth();
  const dispatch = useDispatch();
  const { accountDetails } = useAccountDetails();
  const [isPageReady, setIsPageReady] = useState<boolean>(false);
  const [getAllAccounts] = useLazyGetAllAccountsQuery();
  const [getAllProjects] = useLazyGetAllProjectsQuery();
  const [getUserPermissionsApi] = useLazyGetUserPermissionsQuery();
  const refreshTimeoutRef = useRef<any>(null);
  const [refreshUserToken] = useRefreshUserTokenMutation({});
  const [showNoProjectsPage, setShowNoProjectsPage] = useState<boolean>(false);

  const refreshToken = async () => {
    const refresh_token = Cookies.get("refresh_token");
    if (!refresh_token) {
      notify.error("Session expired. Please log in again.");
      auth.signoutRedirect();
      return;
    }

    const client_id =
      window?.env?.VITE_KEYCLOAK_CLIENT_ID ||
      import.meta.env.VITE_KEYCLOAK_CLIENT_ID;
    const client_secret =
      window?.env?.VITE_KEYCLOAK_CLIENT_SECRET ||
      import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;
    const body = {
      refresh_token,
      client_id,
      client_secret,
      grant_type: "refresh_token",
    };

    try {
      const response = await refreshUserToken(body).unwrap();
      if (!response) throw new Error("Failed to refresh token");

      Cookies.set("access_token", response.access_token);
      Cookies.set("refresh_token", response.refresh_token);

      const expiresIn = response.expires_in || 120;
      const refreshDelay = (expiresIn - 60) * 1000;

      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = setTimeout(refreshToken, refreshDelay);
    } catch (error) {
      console.error("Token refresh failed:", error);
      notify.error("Session expired. Please log in again.");
      auth.signoutRedirect();
    }
  };

  useEffect(() => {
    if (auth.isAuthenticated) {
      const expiresIn =
        parseInt(Cookies.get("expires_in") as string, 10) || 120;
      const refreshDelay = (expiresIn - 60) * 1000;
      refreshTimeoutRef.current = setTimeout(refreshToken, refreshDelay);
    }

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!auth.isAuthenticated && !auth.isLoading && !auth.activeNavigator) {
      auth.signinRedirect();
    }
  }, [auth]);

  const getAccounts = async () => {
    if (
      localStorage.getItem("account_id") === null ||
      localStorage.getItem("account_id") === undefined
    ) {
      try {
        const allAccounts = await getAllAccounts("").unwrap();
        localStorage.setItem('account_id', allAccounts?.[0]?.id);
      } catch (error) {
        notify.error("Unable to fetch accounts. Please try again later.");
        console.error("Failed to fetch accounts:", error);
      }
    }
  };

  const getProjects = () => {
    getAllProjects(localStorage.getItem("account_id"))
      .unwrap()
      .then((resp) => {
        dispatch(setAllProjectList(resp));
        let selected_project_id =
          localStorage.getItem("selected_project_id") || undefined;
        if (selected_project_id) {
          const projectIdFound = resp?.find(
            (row: ProjectApiType) => row.id === selected_project_id
          );
          if (!projectIdFound) selected_project_id = undefined;
        }
        dispatch(setProject(selected_project_id || resp?.[0]?.id));
        setIsPageReady(true);
      });
  };

  useEffect(() => {
    if (auth.isAuthenticated) {
      (async () => {
        const result = await getUserPermissionsApi('').unwrap();
        const resp = result?.data || {};
        dispatch(
            setUserPermissions({id: result?.id, roles: resp.roles || []})
        );
        if (resp?.roles?.length > 0) {
          await getAccounts();
          getProjects();
        } else {
          setShowNoProjectsPage(true);
        }
      })();
    }
  }, [
    auth.isAuthenticated,
    dispatch,
    getAllProjects,
    getUserPermissionsApi,
    accountDetails?.id,
  ]);

  switch (auth.activeNavigator) {
    case "signinSilent":
      return <div>Signing you in...</div>;
    case "signoutRedirect":
      return <div>Signing you out...</div>;
  }

  if (auth.isLoading) {
    return (
      <div className="h-screen flex justify-center items-center">
        Loading....
      </div>
    );
  } else if (auth.error) {
    return <div>Oops... {auth.error.message}</div>;
  } else if (showNoProjectsPage) {
    return (
      <NoProjects />
    );
  } else if (auth.isAuthenticated && !isPageReady) {
    Cookies.set("access_token", auth.user?.access_token || "");
    Cookies.set("refresh_token", auth.user?.refresh_token || "");
    return (
      <div className="h-screen flex justify-center items-center">
        Authenticated, checking permissions, kindly wait...
      </div>
    );
  } else if (auth.isAuthenticated && isPageReady) {
    return <>{children}</>;
  }

  return null;
};

export default AuthGuard;
