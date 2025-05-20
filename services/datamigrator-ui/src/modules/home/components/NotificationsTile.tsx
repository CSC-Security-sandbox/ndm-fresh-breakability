import { Box } from "@components/container/index";
import { Card, Text } from "@netapp/bxp-design-system-react";
import { NotificationsTileType } from "@modules/home/home.interface";

const NotificationsTile = ({ Icon, content, title }: NotificationsTileType) => {
  return (
    <Card>
      <Box className="p-3 flex flex-col gap-2">
        <Box className="flex gap-3 items-center">
          {Icon}
          <Box className="text-sm font-semibold">{title}</Box>
        </Box>
        <Text className="pl-9">{content}</Text>
      </Box>
    </Card>
  );
};

export default NotificationsTile;
