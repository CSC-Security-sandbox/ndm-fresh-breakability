/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    env: Partial<ImportMetaEnv>; // Makes all env variables optional
  }
}

// Augment ImportMeta inside "vite/client"
declare module "vite/client" {
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_PORT: string;
  readonly VITE_SESSION_KEY: string;
  readonly VITE_HARD_CODE_ACCOUNT_ID: string;
  readonly VITE_API_LIMIT: string;
  readonly VITE_TIME_INTERVAL: string;
  readonly VITE_ADMIN_SERVICE_URL: string;
  readonly VITE_CONFIG_SERVICE_URL: string;
  readonly VITE_JOBS_SERVICE_URL: string;
  readonly VITE_WORKERS_SERVICE_URL: string;
  readonly VITE_REPORTS_SERVICE_URL: string;
  readonly VITE_ADMIN_SERVICE_ENDPOINT: string;
  readonly VITE_CONFIG_SERVICE_ENDPOINT: string;
  readonly VITE_JOBS_SERVICE_ENDPOINT: string;
  readonly VITE_WORKERS_SERVICE_ENDPOINT: string;
  readonly VITE_REPORTS_SERVICE_ENDPOINT: string;
  readonly VITE_KEYCLOAK_HOST: string;
  readonly VITE_KEYCLOAK_REALM: string;
  readonly VITE_KEYCLOAK_CLIENT: string;
  readonly VITE_KEYCLOAK_AUTHORITY: string;
  readonly VITE_KEYCLOAK_GRANT_TYPE: string;
  readonly VITE_KEYCLOAK_CLIENT_ID: string;
  readonly VITE_KEYCLOAK_CLIENT_SECRET: string;
  readonly VITE_KEYCLOAK_REDIRECT_URI: string;
  readonly VITE_KEYCLOAK_RESPONSE_TYPE: string;
  readonly VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI: string;
  readonly VITE_GRAFANA_URL: string;
}
