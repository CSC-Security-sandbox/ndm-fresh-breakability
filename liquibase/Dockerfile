FROM liquibase/liquibase:4.32.0-alpine

ENV LIQUIBASE_COMMAND_DRIVER=org.postgresql.Driver \
    LIQUIBASE_COMMAND_CHANGELOG_FILE=./liquibase/changelog-master.xml

WORKDIR /app/liquibase

COPY changelog-master.xml /app/liquibase/
COPY apply/*.sql /app/liquibase/
COPY --chmod=755 entrypoint.sh /app/

ENTRYPOINT ["/app/entrypoint.sh"]