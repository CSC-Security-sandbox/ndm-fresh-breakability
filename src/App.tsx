// src/App.jsx
// import React from "react";
// import { useAuth } from "react-oidc-context";

// function App() {
//   const auth = useAuth();

//   switch (auth.activeNavigator) {
//     case "signinSilent":
//       return <div>Signing you in...</div>;
//     case "signoutRedirect":
//       return <div>Signing you out...</div>;
//   }

//   if (auth.isLoading) {
//     return <div>Loading...</div>;
//   }

//   if (auth.error) {
//     return <div>Oops... {auth.error.message}</div>;
//   }

//   if (auth.isAuthenticated) {
//     return (
//       <div>
//         Hello {auth.user?.profile.sub}{" "}
//         <button onClick={() => void auth.removeUser()}>Log out</button>
//       </div>
//     );
//   } else {
//     auth.signinRedirect();
//   }

//   return <button onClick={() => void auth.signinRedirect()}>Log in</button>;
// }

// export default App;

import "@netapp/bxp-design-system-react/dist/index.css";
import { Route, Routes } from "react-router-dom";
import FileServer from "./pages/FileServer";
import Home from "./pages/Home";
import SpeedTest from "./pages/SpeedTest";

// import { useAuth } from "react-oidc-context";

import HomeLayout from "./components/layout/HomeLayout";
import NotFound from "./components/404/PageNotFound";
const App = () => {
  // const auth = useAuth();
  return (
    <div className="">
      <Routes>
        <Route path="/" element={<HomeLayout />}>
          <Route index path="/home" element={<Home />} />
          <Route path="/speed-test" element={<SpeedTest />} />
          <Route path="/workers" element={<SpeedTest />} />
          <Route path="/contact" element={<FileServer />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </div>
  );
};

export default App;
