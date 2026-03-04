import { Box } from "@components/container/index";
import { JobDescriptionProps, JOBS_TYPE } from "@/types/app.type";
import {
  Card,
  Text,
  Button,
  CardHeader,
  CardTitle,
  CardContent,
  CardContentLoading,
} from "@netapp/bxp-design-system-react";
import { VolIcon } from "@netapp/bxp-style/react-icons/Storage";
import JobDescriptionColumn from "@modules/jobs/jobs-list/job-details/components/JobDescriptionColumn";
import { useNavigate } from "react-router-dom";

const JobDescription = (props: JobDescriptionProps) => {
  const { source, destination, jobType, workerCount, workersUrl } = props;
  const navigate = useNavigate();

  if (!source) {
    return (
      <Card className="h-full flex p-10">
        <CardContentLoading />
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex gap-4 items-center">
          <VolIcon />
          <Text bold>Job Configuration</Text>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex gap-4 justify-between">
        <Box className="flex flex-col gap-4 w-1/2">
          <JobDescriptionColumn
            name="Source File Server"
            value={source.serverName}
          />
          <JobDescriptionColumn
            name="Source Export Path"
            value={source.path}
          />
          {jobType !== JOBS_TYPE.DISCOVERY && (
            <JobDescriptionColumn
              name="Source Directory Path"
              value={source.directoryPath || "-"}
            />
          )}
          <JobDescriptionColumn
            name="Protocol"
            value={source.protocol}
          />
          {workerCount !== undefined && (
            <JobDescriptionColumn
              name="Workers"
              value={
                workersUrl ? (
                  <Button variant="text" onClick={() => navigate(workersUrl)}>
                    {workerCount}
                  </Button>
                ) : (
                  workerCount
                )
              }
            />
          )}
        </Box>
        {destination && destination.serverName && (
          <Box className="flex flex-col gap-4 w-1/2">
            <JobDescriptionColumn
              name="Destination File Server"
              value={destination.serverName}
            />
            <JobDescriptionColumn
              name="Destination Export Path"
              value={destination.path}
            />
            <JobDescriptionColumn
              name="Destination Directory Path"
              value={destination.directoryPath || "-"}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default JobDescription;
