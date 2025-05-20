import { Box } from "@components/container/index";
import JobTaskErrors from "@modules/jobs/job-task-errors/JobTaskErrors";

const JobTaskErrorsPage = () => {
  return (
    <Box className="p-8">
      <JobTaskErrors />
    </Box>
  );
};

export default JobTaskErrorsPage;
