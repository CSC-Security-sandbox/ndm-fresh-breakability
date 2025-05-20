import { registerAs } from "@nestjs/config";
import { KeyclaokOptions } from "./types";

export default registerAs('keycloakOptions', (): KeyclaokOptions => ({
    keycloakBaseUrl : process.env.KEYCLOAK_BASE_URL,
    realm : process.env.KEYCLOAK_REALM,
}));