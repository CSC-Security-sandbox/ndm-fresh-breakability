/* eslint-disable @typescript-eslint/no-explicit-any */
import {useEffect, useState} from 'react';
import {useAuth} from 'react-oidc-context';
import {useDispatch} from 'react-redux';
import {setUserPermissions} from '@store/reducer/permissionSlice';
import {setAuthToken, clearAuth} from '@store/reducer/authSlice';
import {useLazyGetUserPermissionsQuery} from '@api/permissionApi';
import useAccountDetails from '@hooks/useAccountDetails';
import {useLazyGetAllProjectsQuery} from '@api/projectApi';
import {setAllProjectList, setProject} from '@store/reducer/appSlice';
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
  const [showNoProjectsPage, setShowNoProjectsPage] = useState<boolean>(false);

  useEffect(() => {
    if (!auth.isAuthenticated && !auth.isLoading && !auth.activeNavigator) {
      dispatch(clearAuth());
      auth.signinRedirect();
    } else if (auth.isAuthenticated && auth.user?.access_token) {
      dispatch(setAuthToken(auth.user.access_token));
    }
  }, [auth, dispatch]);

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
