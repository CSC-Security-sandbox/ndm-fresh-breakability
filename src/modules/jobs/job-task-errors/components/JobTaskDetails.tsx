import { Box } from "@components/container/index";
import { Card, FormFieldSelect, Text } from "@netapp/bxp-design-system-react";
import DetailTile from "./DetailTile";

const JobTaskDetails = () => {
  return (
    <Card className="flex justify-between p-6 gap-16">
      <DetailTile title="File Server" value="Name" />
      <DetailTile title="Destination File Server" value="Name" />
      <DetailTile title="Source Path" value="Name" />
      <DetailTile title="Destination Path" value="Name" />
    </Card>
  );
};

export default JobTaskDetails;
