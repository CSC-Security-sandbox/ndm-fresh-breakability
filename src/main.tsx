import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@netapp/bxp-design-system-react";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { _persistedStore, store } from "./store/store.ts";
import AuthGuard from "./auth/AuthGuard.tsx";
import AuthenticationProvider from "@/auth/AuthenticationProvider";
import "@netapp/bxp-design-system-react/dist/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate persistor={_persistedStore}>
        <BrowserRouter>
          <AuthenticationProvider>
            <AuthGuard>
              <ThemeProvider theme="light" isRoot={true}>
                <App />
              </ThemeProvider>
            </AuthGuard>
          </AuthenticationProvider>
        </BrowserRouter>
      </PersistGate>
    </Provider>
  </StrictMode>
);
