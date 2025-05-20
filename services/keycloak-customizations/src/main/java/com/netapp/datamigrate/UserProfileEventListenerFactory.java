package com.netapp.datamigrate;
 
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.Config;
 
/**
* Factory class for creating instances of the {@link UserProfileEventListener}.
* This factory integrates the event listener with the Keycloak Event Listener SPI.
*/
public class UserProfileEventListenerFactory implements EventListenerProviderFactory {
 
    /**
     * Creates a new instance of {@link UserProfileEventListener}.
     *
     * @param session the Keycloak session instance
     * @return a new {@link EventListenerProvider} instance
     */
    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new UserProfileEventListener(session);
    }
 
    /**
     * Returns the unique identifier for this factory.
     *
     * @return the factory identifier as a {@link String}
     */
    @Override
    public String getId() {
        return "user-profile-event-listener";
    }
 
    /**
     * Initializes the factory with the provided configuration.
     * 
     * @param config the configuration scope for this factory
     */
    @Override
    public void init(Config.Scope config) {
        // No specific initialization required for this factory
    }
 
    /**
     * Performs post-initialization tasks for the factory.
     *
     * @param factory the Keycloak session factory
     */
    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // No specific post-initialization tasks required
    }
 
    /**
     * Closes the factory and releases any resources if necessary.
     */
    @Override
    public void close() {
        // No specific resources to close for this factory
    }
}