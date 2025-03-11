import { Button, Breadcrumbs } from "@netapp/bxp-design-system-react";
import { useNavigate, useParams } from "react-router-dom";
import { Box } from "@components/container";

const JobTaskErrorsBreadcrumbs = () => {
  const navigate = useNavigate();
  const { jobId, jobRunId } = useParams<{ jobId: string; jobRunId: string }>();

  return (
    <Breadcrumbs className="mb-4">
      <Button onClick={() => navigate("/jobs-list")} variant="text">
        Jobs
      </Button>
      <Button onClick={() => navigate(`/job-details/${jobId}`)} variant="text">
        Job Details
      </Button>
      <Box>Errors</Box>
    </Breadcrumbs>
  );
};

export default JobTaskErrorsBreadcrumbs;
