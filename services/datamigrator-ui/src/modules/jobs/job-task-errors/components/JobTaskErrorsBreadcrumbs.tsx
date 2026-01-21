import { Breadcrumbs } from "@netapp/bxp-design-system-react";
import { useParams, useLocation, Link } from "react-router-dom";
import { Box } from "@components/container";

const JobTaskErrorsBreadcrumbs = () => {
  const { jobId, jobRunId } = useParams<{ jobId: string; jobRunId: string }>();
  const location = useLocation();
  const isJobRunErrorsScreen = location.pathname.includes("run");

  return (
    <>
      {!isJobRunErrorsScreen && (
        <Breadcrumbs>
          <Link to="/jobs-list">Jobs</Link>
          <Link to={`/job-details/${jobId}`}>Job Config Details</Link>

          <Box>Errors</Box>
        </Breadcrumbs>
      )}
      {isJobRunErrorsScreen && (
        <Breadcrumbs>
          <Link to={`/job-details/${jobId}`}>Job Config Details</Link>
          <Link to={`/job-details/${jobId}/run/${jobRunId}`}>
            Job Run Details
          </Link>
          <Box>Errors</Box>
        </Breadcrumbs>
      )}
    </>
  );
};

export default JobTaskErrorsBreadcrumbs;
