import { v4 as uuidv4 } from 'uuid';

interface ProtocolMapper {
  name: string;
  protocol: string;
  protocolMapper: string;
  consentRequired: boolean;
  config: {
    [key: string]: string | boolean;
  };
}

export class ClientConfig {
  clientId: string;
  enabled: boolean;
  name: string;
  clientAuthenticatorType: string;
  secret: string;
  fullScopeAllowed: boolean;
  serviceAccountsEnabled:boolean
  protocolMappers: ProtocolMapper[];

  constructor(projectId: string | undefined) {
    this.clientId = uuidv4();
    this.enabled = true;
    this.name = `worker-${this.clientId}`;
    this.clientAuthenticatorType = "client-secret";
    this.secret = uuidv4();
    this.fullScopeAllowed = false;
    this.serviceAccountsEnabled = true;
    this.protocolMappers = [
      {
        name: "worker-project-claim",
        protocol: "openid-connect",
        protocolMapper: "oidc-hardcoded-claim-mapper",
        consentRequired: false,
        config: {
          "claim.name": "project_id",
          "claim.value": projectId,
          "id.token.claim": true,
          "access.token.claim": true,
          "jsonType.label": "String",
        }
      },
    ];
  }

  setClientId(clientId: string): void {
    if (!clientId) {
      throw new Error("Client ID cannot be empty");
    }
    this.clientId = clientId;
  }

  setSecret(secret: string): void {
    if (!secret) {
      throw new Error("Secret cannot be empty");
    }
    this.secret = secret;
  }

  setName(name: string): void {
    this.name = name;
  }

  setProjectId(projectId: string): void {
    const protocolMapper = this.protocolMappers.find(
      (mapper) => mapper.name === "custom-client-claim"
    );
    if (protocolMapper) {
      protocolMapper.config["claim.value"] = projectId;
    }
  }

  getConfig() {
    return {
      clientId: this.clientId,
      enabled: this.enabled,
      name: this.name,
      clientAuthenticatorType: this.clientAuthenticatorType,
      secret: this.secret,
      fullScopeAllowed: this.fullScopeAllowed,
      serviceAccountsEnabled: this.serviceAccountsEnabled,
      protocolMappers: this.protocolMappers
    };
  }
}
