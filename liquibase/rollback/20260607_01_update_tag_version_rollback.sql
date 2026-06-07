UPDATE liquibase.databasechangelog
SET tag = NULL
WHERE orderexecuted = (
    SELECT MAX(orderexecuted) FROM liquibase.databasechangelog
);
