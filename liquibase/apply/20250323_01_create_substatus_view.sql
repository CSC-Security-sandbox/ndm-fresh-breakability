CREATE OR REPLACE VIEW job_status_view AS
SELECT 
    jr.id,
    jc.job_type,
    jr.status AS status,
    CASE 
        WHEN jc.job_type = 'CUT_OVER' AND jr.status = 'COMPLETED' THEN jr.sub_status
        ELSE jr.status
    END AS sub_status
FROM jobrun jr
JOIN jobconfig jc ON jr.job_config_id = jc.id;
