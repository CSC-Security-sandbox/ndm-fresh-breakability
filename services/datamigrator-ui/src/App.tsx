import RootLayout from "@/components/root-layout/RootLayout";
import "@netapp/bxp-design-system-react/dist/index.css";
import { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import ProtectedRoute from "@auth/protected-route/ProtectedRoute";
import { routeConfig } from "@routes/RouteConfig";
import { Box } from "@components/container/index";
import { Show } from "@components/show/Show";

const renderRoutes = (routes) =>
  routes.map((route) => (
    <Route
      key={route.path}
      path={route.path}
      element={
        <Show>
          <Show.When isTrue={route.protected}>
            <ProtectedRoute
              requiredPermission={route.requiredPermission}
              redirectTo="/no-access"
            >
              {route.element}
            </ProtectedRoute>
          </Show.When>
          <Show.Else>{route.element}</Show.Else>
        </Show>
      }
    />
  ));

const App = () => {
  return (
    <Suspense fallback={<Box>Loading...</Box>}>
      <Routes>
        <Route path="/" element={<RootLayout />}>
          {renderRoutes(routeConfig)}
        </Route>
      </Routes>
    </Suspense>
  );
};

export default App;
