import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@netapp/bxp-design-system-react";
// import { Provider } from "react-redux";
// import { PersistGate } from "redux-persist/integration/react";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme="light" isRoot={true}>
      {/* <Provider store={store}> */}
      {/* <PersistGate persistor={_persistedStore}> */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
      {/* </PersistGate> */}
      {/* </Provider> */}
    </ThemeProvider>
  </StrictMode>
);
