UPDATE liquibase.databasechangelog
SET tag = '2026.03.0'
WHERE orderexecuted = (
    SELECT MAX(orderexecuted) FROM liquibase.databasechangelog
);
