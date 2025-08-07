import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@/App.tsx";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@netapp/bxp-design-system-react";
import { Provider, useSelector } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { _persistedStore, store, RootStateType } from "@/store/store.ts";
import AuthGuard from "@/auth/AuthGuard.tsx";
import AuthenticationProvider from "@/auth/AuthenticationProvider";
import "@netapp/bxp-design-system-react/dist/index.css";
import Modal from "@components/modal/ModalWrapper.tsx";
import SideDrawer from "@components/side-drawer/SideDrawer.tsx";
import { Box } from "@components/container/index.tsx";
import TopProgressBar from "@components/top-progress-bar/TopProgressBar.tsx";

// ThemeWrapper component to properly use the useSelector hook
const ThemeWrapper = ({ children }) => {
  // Now useSelector is used inside a component function
  const theme = useSelector((state: RootStateType) => state.appSlice.theme);

  return (
    <ThemeProvider theme={theme} isRoot={true}>
      {children}
    </ThemeProvider>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Box className="!overflow-hidden h-screen">
      <BrowserRouter>
        <TopProgressBar />
        <Provider store={store}>
          <PersistGate persistor={_persistedStore}>
            <AuthenticationProvider>
              <ThemeWrapper>
                <AuthGuard>
                  <Modal />
                  <SideDrawer />
                  <App />
                </AuthGuard>
              </ThemeWrapper>
            </AuthenticationProvider>
          </PersistGate>
        </Provider>
      </BrowserRouter>
    </Box>
  </StrictMode>
);
