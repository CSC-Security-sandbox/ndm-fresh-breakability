import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@/App.tsx";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@netapp/bxp-design-system-react";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { _persistedStore, store } from "@/store/store.ts";
import AuthGuard from "@/auth/AuthGuard.tsx";
import AuthenticationProvider from "@/auth/AuthenticationProvider";
import "@netapp/bxp-design-system-react/dist/index.css";
import Modal from "@components/modal/ModalWrapper.tsx";
import SideDrawer from "@components/side-drawer/SideDrawer.tsx";
import { Box } from "@components/container/index.tsx";
import TopProgressBar from "@components/top-progress-bar/TopProgressBar.tsx";
import EulaReacceptModal from "@components/modal/EulaReacceptModal.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Box className="!overflow-hidden h-screen">
      <BrowserRouter>
        <TopProgressBar />
        <ThemeProvider theme="light" isRoot={true}>
          <Provider store={store}>
            <PersistGate persistor={_persistedStore}>
              <AuthenticationProvider>
                <AuthGuard>
                  <Modal />
                  <SideDrawer />
                  <EulaReacceptModal />
                  <App />
                </AuthGuard>
              </AuthenticationProvider>
            </PersistGate>
          </Provider>
        </ThemeProvider>
      </BrowserRouter>
    </Box>
  </StrictMode>
);
