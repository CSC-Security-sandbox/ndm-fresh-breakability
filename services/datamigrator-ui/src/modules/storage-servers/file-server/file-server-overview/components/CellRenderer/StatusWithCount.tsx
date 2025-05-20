import { Text } from "@netapp/bxp-design-system-react";

const StatusWithCount = ({
  title,
  count,
}: {
  title: string;
  count: number;
}) => {
  if (count !== 0)
    return (
      <Text>
        {title}: {count}
      </Text>
    );

  return null;
};

export default StatusWithCount;
