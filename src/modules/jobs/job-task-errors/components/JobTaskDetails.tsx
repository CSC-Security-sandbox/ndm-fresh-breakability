import { JobTaskDetailsPropsType } from "@modules/jobs/job-task-errors/JobTaskErrorsTabs.interface";
import { Card } from "@netapp/bxp-design-system-react";
import DetailTile from "./DetailTile";

const JobTaskDetails = ({ jobConfigDetails }: JobTaskDetailsPropsType) => {
  return (
    <Card className="flex justify-between p-6 gap-16">
      <DetailTile
        title="Source"
        value={jobConfigDetails?.sourceServer?.serverName || "NA"}
      />
      <DetailTile
        title="Destination"
        value={jobConfigDetails?.destinationServer?.serverName || "NA"}
      />
      <DetailTile
        title="Source Path"
        value={jobConfigDetails?.sourceServer?.path || "NA"}
      />
      <DetailTile
        title="Destination Path"
        value={jobConfigDetails?.destinationServer?.path || "NA"}
      />
    </Card>
  );
};

export default JobTaskDetails;
