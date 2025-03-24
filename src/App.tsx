import Layout from "@components/route-layout/Layout";
import "@netapp/bxp-design-system-react/dist/index.css";
import { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import ProtectedRoute from "@auth/protected-route/ProtectedRoute";
import { routeConfig } from "@routes/RouteConfig";
import { Box } from "@components/container/index";

const App = () => {
  return (
    <Suspense fallback={<Box>Loading...</Box>}>
      <Routes>
        <Route path="/" element={<Layout />}>
          {routeConfig.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={
                route.protected ? (
                  <ProtectedRoute
                    requiredPermission={route.requiredPermission}
                    redirectTo="/no-access"
                  >
                    {route.element}
                  </ProtectedRoute>
                ) : (
                  route.element
                )
              }
            />
          ))}
        </Route>
      </Routes>
    </Suspense>
  );
};

export default App;
