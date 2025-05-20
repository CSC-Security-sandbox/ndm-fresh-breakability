import { Box } from "@components/container/index";
import { JobDescriptionProps } from "@/types/app.type";
import {
  Card,
  Text,
  CardHeader,
  CardTitle,
  CardContent,
  CardContentLoading,
} from "@netapp/bxp-design-system-react";
import { VolIcon } from "@netapp/bxp-style/react-icons/Storage";
import JobDescriptionColumn from "@modules/jobs/jobs-list/job-details/components/JobDescriptionColumn";

const JobDescription = (props: JobDescriptionProps) => {
  const { source, destination } = props;
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
        <CardTitle className="flex gap-4">
          <VolIcon />
          <Text>{source.serverName}</Text>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex gap-4 justify-between">
        <Box className="flex flex-col gap-4 grow">
          {/* <JobDescriptionColumn name="Id" value={id || ""} /> */}
          <JobDescriptionColumn name="Source Path" value={source.path} />
          <JobDescriptionColumn name="Protocol" value={source.protocol} />
        </Box>

        {destination && destination.serverName && (
          <Box className="flex flex-col gap-4 grow">
            <JobDescriptionColumn
              name="Destination"
              value={destination.serverName}
            />
            <JobDescriptionColumn
              name="destination Path"
              value={destination.path}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default JobDescription;
