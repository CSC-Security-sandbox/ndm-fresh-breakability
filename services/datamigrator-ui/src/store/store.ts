import { configureStore, combineReducers, Middleware } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { persistReducer, persistStore } from "redux-persist";
import createWebStorage from "redux-persist/lib/storage/createWebStorage";
import { usersApi } from "@api/userApi";
import { projectApi } from "@api/projectApi";
import { accountApi } from "@api/accountApi";
import { permissionApi } from "@api/permissionApi";
import { appSlice } from "@store/reducer/appSlice";
import { authSlice } from "@store/reducer/authSlice";
import { configApi } from "@api/configApi";
import { commonComponentSlice } from "@store/reducer/commonComponentSlice";
import { permissionSlice } from "@store/reducer/permissionSlice";
import { jobsApi } from "@api/jobsApi";
import { workersApi } from "@api/workersApi";
import { reportApi } from "@api/reportApi";
import { workerManagerApi } from "@api/workerManagerApi";
import { aboutApi } from "@api/aboutApi";

const createNoopStorage = () => {
  return {
    getItem() {
      return Promise.resolve(null);
    },
    setItem(_key: string, value: string) {
      return Promise.resolve(value);
    },
    removeItem() {
      return Promise.resolve();
    },
  };
};

const storage =
  typeof window !== "undefined"
    ? createWebStorage("local")
    : createNoopStorage();

const persistConfig = {
  key: "root",
  version: 1,
  storage,
  whitelist: ["appSlice", "authSlice", "permissionSlice"], // Only persist this states
};

const reducer = combineReducers({
  appSlice: appSlice.reducer,
  authSlice: authSlice.reducer,
  permissionSlice: permissionSlice.reducer,
  commonComponentSlice: commonComponentSlice.reducer,
  [permissionApi.reducerPath]: permissionApi.reducer,
  [accountApi.reducerPath]: accountApi.reducer,
  [projectApi.reducerPath]: projectApi.reducer,
  [usersApi.reducerPath]: usersApi.reducer,
  [configApi.reducerPath]: configApi.reducer,
  [jobsApi.reducerPath]: jobsApi.reducer,
  [workersApi.reducerPath]: workersApi.reducer,
  [reportApi.reducerPath]: reportApi.reducer,
  [workerManagerApi.reducerPath]: workerManagerApi.reducer,
  [aboutApi.reducerPath]: aboutApi.reducer,
});

const persistedReducer = persistReducer(persistConfig, reducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ 
      serializableCheck: {
        ignoredActions: [
          "persist/PERSIST", 
          "persist/REHYDRATE",
          "persist/REGISTER",
          "persist/PAUSE",
          "persist/PURGE"
        ],
        ignoredActionsPaths: ["meta.arg", "payload.timestamp"],
        ignoredPaths: ["_persist"]
      }
    }).concat([
      permissionApi.middleware,
      accountApi.middleware,
      projectApi.middleware,
      usersApi.middleware,
      configApi.middleware,
      jobsApi.middleware,
      workersApi.middleware,
      reportApi.middleware,
      workerManagerApi.middleware,
      aboutApi.middleware
    ] as Middleware[]),
});

export type RootStateType = ReturnType<typeof store.getState>;

export const _persistedStore = persistStore(store);

setupListeners(store.dispatch);
