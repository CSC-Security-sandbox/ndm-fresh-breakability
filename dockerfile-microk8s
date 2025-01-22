FROM maven:3.9.6-eclipse-temurin-21-alpine AS maven
WORKDIR /usr/src/app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests


FROM public.ecr.aws/docker/library/busybox:stable-glibc

RUN mkdir -p /keycloak/custom/themes && \
    mkdir -p /keycloak/custom/providers 

COPY themes /keycloak/custom/themes
COPY --from=maven /usr/src/app/target/*.jar /keycloak/custom/providers