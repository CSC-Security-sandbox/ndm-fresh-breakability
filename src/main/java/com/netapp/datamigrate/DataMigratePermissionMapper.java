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
 
/**
* A custom Keycloak protocol mapper for mapping user permissions into tokens.
* This mapper retrieves user permissions and roles from the database and injects them
* as claims in Keycloak tokens (Access Token, ID Token, and User Info Token).
*/
public class DataMigratePermissionMapper extends AbstractOIDCProtocolMapper 
        implements OIDCAccessTokenMapper, OIDCIDTokenMapper, UserInfoTokenMapper {
 
    /**
     * Unique identifier for this protocol mapper.
     */
    public static final String PROVIDER_ID = "netapp-mapper";
 
    /**
     * Configuration properties for the mapper.
     */
    private static final List<ProviderConfigProperty> configProperties = new ArrayList<>();
 
    static {
        // Configuration for claim name
        ProviderConfigProperty claimNameConfig = new ProviderConfigProperty();
        claimNameConfig.setName(OIDCAttributeMapperHelper.TOKEN_CLAIM_NAME);
        claimNameConfig.setLabel("Claim Name");
        claimNameConfig.setHelpText("Name of the claim to insert into the token");
        claimNameConfig.setType(ProviderConfigProperty.STRING_TYPE);
        configProperties.add(claimNameConfig);
 
        // Configuration for including the claim in access tokens
        ProviderConfigProperty includeInTokensConfig = new ProviderConfigProperty();
        includeInTokensConfig.setName(OIDCAttributeMapperHelper.INCLUDE_IN_ACCESS_TOKEN);
        includeInTokensConfig.setLabel("Include in Access Token");
        includeInTokensConfig.setHelpText("Include this claim in the access token");
        includeInTokensConfig.setType(ProviderConfigProperty.BOOLEAN_TYPE);
        configProperties.add(includeInTokensConfig);
    }
 
    /**
     * Gets the display category for the mapper.
     *
     * @return the display category
     */
    @Override
    public String getDisplayCategory() {
        return "Token Mapper";
    }
 
    /**
     * Gets the display type for the mapper.
     *
     * @return the display type
     */
    @Override
    public String getDisplayType() {
        return "DataMigrate Permission Mapper";
    }
 
    /**
     * Provides help text explaining the purpose of this mapper.
     *
     * @return the help text
     */
    @Override
    public String getHelpText() {
        return "Maps the user's ID and permissions to Keycloak tokens based on email.";
    }
 
    /**
     * Retrieves the configuration properties for the mapper.
     *
     * @return the configuration properties
     */
    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return configProperties;
    }
 
    /**
     * Gets the unique ID for this mapper.
     *
     * @return the provider ID
     */
    @Override
    public String getId() {
        return PROVIDER_ID;
    }
 
    /**
     * Sets a custom claim in the token by fetching user permissions and roles.
     *
     * @param token              the token in which the claim is to be set
     * @param mappingModel       the protocol mapper model
     * @param userSession        the user session model
     * @param keycloakSession    the Keycloak session
     * @param clientSessionContext the client session context
     */
    @Override
    protected void setClaim(IDToken token, ProtocolMapperModel mappingModel, UserSessionModel userSession,
                            KeycloakSession keycloakSession, ClientSessionContext clientSessionContext) {
        // Retrieve the claim name from the configuration or default to "user"
        String claimName = mappingModel.getConfig().getOrDefault(OIDCAttributeMapperHelper.TOKEN_CLAIM_NAME, "user");
 
        // Fetch user permissions using the helper method
        Map<String, Object> user = getUserPermissions(userSession);
 
        // Add the claim to the token if data is present
        if (user != null) {
            token.getOtherClaims().put(claimName, user);
        }
    }
}