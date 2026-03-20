UPDATE liquibase.databasechangelog
SET tag = '2026.03.1'
WHERE orderexecuted = (
    SELECT MAX(orderexecuted) FROM liquibase.databasechangelog
);
