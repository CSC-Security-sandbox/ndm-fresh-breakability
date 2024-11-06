package com.netapp.datamigrate;

import org.keycloak.models.ClientSessionContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.protocol.oidc.mappers.OIDCIDTokenMapper;
import org.keycloak.protocol.oidc.mappers.UserInfoTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;
import org.keycloak.protocol.oidc.mappers.OIDCAttributeMapperHelper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.netapp.datamigrate.utils.UserPermissionFetcher.getUserPermissions;


public class DataMigratePermissionMapper extends AbstractOIDCProtocolMapper implements OIDCAccessTokenMapper, OIDCIDTokenMapper, UserInfoTokenMapper {
    public static final String PROVIDER_ID = "netapp-mapper";
    private static final List<ProviderConfigProperty> configProperties = new ArrayList<>();

    static {
        ProviderConfigProperty claimNameConfig = new ProviderConfigProperty();
        claimNameConfig.setName(OIDCAttributeMapperHelper.TOKEN_CLAIM_NAME);
        claimNameConfig.setLabel("Claim Name");
        claimNameConfig.setHelpText("Name of the claim to insert into the token");
        claimNameConfig.setType(ProviderConfigProperty.STRING_TYPE);
        configProperties.add(claimNameConfig);

        ProviderConfigProperty includeInTokensConfig = new ProviderConfigProperty();
        includeInTokensConfig.setName(OIDCAttributeMapperHelper.INCLUDE_IN_ACCESS_TOKEN);
        includeInTokensConfig.setLabel("Include in Access Token");
        includeInTokensConfig.setHelpText("Include this claim in the access token");
        includeInTokensConfig.setType(ProviderConfigProperty.BOOLEAN_TYPE);
        configProperties.add(includeInTokensConfig);
    }

    @Override
    public String getDisplayCategory() {
        return "Token Mapper";
    }

    @Override
    public String getDisplayType() {
        return "DataMigrate Permission Mapper";
    }

    @Override
    public String getHelpText() {
        return "Maps the user's ID to Keycloak tokens based on email.";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return configProperties;
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    protected void setClaim(IDToken token, ProtocolMapperModel mappingModel, UserSessionModel userSession,
                            KeycloakSession keycloakSession, ClientSessionContext clientSessionContext) {
        String claimName = mappingModel.getConfig().getOrDefault(OIDCAttributeMapperHelper.TOKEN_CLAIM_NAME, "user");
        Map<String, Object> user = getUserPermissions(userSession);
        if (user != null) {
            token.getOtherClaims().put(claimName, user);
        }
    }
}