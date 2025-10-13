FROM liquibase/liquibase:4.33.0-alpine

USER root

RUN apk update && \
    apk upgrade --no-cache && \
    rm -vrf /var/cache/apk/*

# Remove vulnerable Go binary (lpm) to fix CVE-2025-47906
RUN rm -f /liquibase/bin/lpm

USER liquibase

ENV LIQUIBASE_COMMAND_DRIVER=org.postgresql.Driver \
    LIQUIBASE_COMMAND_CHANGELOG_FILE=./liquibase/changelog-master.xml

WORKDIR /app/liquibase

COPY changelog-master.xml /app/liquibase/
COPY apply/*.sql /app/liquibase/
COPY rollback/*.sql /app/liquibase/
COPY --chmod=755 entrypoint.sh /app/

ENTRYPOINT ["/app/entrypoint.sh"]