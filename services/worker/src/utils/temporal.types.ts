export interface TemporalConnectionConfig {
  address: string;
  namespace?: string;
  tlsEnabled: boolean;
  tlsServerName?: string;
  tlsCaCert?: string;
  jwtEnabled: boolean;
  getAccessToken?: () => Promise<string>;
}

export interface TemporalConfig {
  address: string;
  namespace?: string;
  tls?: {
    serverNameOverride?: string;
    serverRootCACertificate?: Buffer;
  };
  metadata?: {
    authorization?: string;
  };
}
