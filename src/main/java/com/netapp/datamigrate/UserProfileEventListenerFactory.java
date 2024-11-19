package com.netapp.datamigrate;
 
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.Config;
 
public class UserProfileEventListenerFactory implements EventListenerProviderFactory {
 
    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new UserProfileEventListener(session);
    }
 
    @Override
    public String getId() {
        return "user-profile-event-listener";
    }

    @Override
    public void init(Config.Scope config) {
        // No-op implementation
    }
 
    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No-op implementation
    }
 
    @Override
    public void close() {
        // Clean up resources if necessary
    }
}