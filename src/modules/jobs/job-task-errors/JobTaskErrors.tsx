import ErrorsListTable from "@modules/jobs/job-task-errors/components/ErrorsListTable";
import JobTaskErrorsTabs from "@modules/jobs/job-task-errors/components/JobTaskErrorsTabs";
import { useState } from "react";
import JobTaskDetails from "@modules/jobs/job-task-errors/components/JobTaskDetails";
import { Box } from "@components/container/index";
import JobTaskErrorsBreadcrumbs from "@modules/jobs/job-task-errors/components/JobTaskErrorsBreadcrumbs";

const JobTaskErrors = () => {
  const [currentTab, setCurrentTab] = useState<number>(1);
  return (
    <Box className="flex flex-col gap-8">
      <JobTaskErrorsBreadcrumbs />
      <JobTaskErrorsTabs
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
      />
      <JobTaskDetails />
      <ErrorsListTable />
    </Box>
  );
};

export default JobTaskErrors;
