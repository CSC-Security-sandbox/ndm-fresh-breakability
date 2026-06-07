UPDATE liquibase.databasechangelog
SET tag = '2026.04.2-2'
WHERE orderexecuted = (
    SELECT MAX(orderexecuted) FROM liquibase.databasechangelog
);
