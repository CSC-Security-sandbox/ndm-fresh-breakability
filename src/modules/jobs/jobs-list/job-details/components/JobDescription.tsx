import { Box } from "@components/container/index";
import { JobDescriptionProps } from "@/types/app.type";
import {
  Card,
  Text,
  CardHeader,
  CardTitle,
  CardContent,
} from "@netapp/bxp-design-system-react";
import { VolIcon } from "@netapp/bxp-style/react-icons/Storage";
import JobDescriptionColumn from "./JobDescriptionColumn";

const JobDescription = (props: JobDescriptionProps) => {
  const { id, source, destination } = props;
  if (!source) return <></>;
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
              name="Destination Server"
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
