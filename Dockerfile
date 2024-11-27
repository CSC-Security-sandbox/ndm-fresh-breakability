FROM maven:3.9.6-eclipse-temurin-21-alpine as maven
WORKDIR /usr/src/app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

FROM quay.io/keycloak/keycloak:latest as builder

WORKDIR /opt/keycloak
# for demonstration purposes only, please make sure to use proper certificates in production instead
RUN keytool -genkeypair -storepass password -storetype PKCS12 -keyalg RSA -keysize 2048 -dname "CN=server" -alias server -ext "SAN:c=DNS:localhost,IP:127.0.0.1" -keystore conf/server.keystore
COPY --chown=keycloak:keycloak --from=maven /usr/src/app/target/*.jar /opt/keycloak/providers/.
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:latest
COPY --from=builder /opt/keycloak/ /opt/keycloak/

ENTRYPOINT ["/opt/keycloak/bin/kc.sh","start-dev"]