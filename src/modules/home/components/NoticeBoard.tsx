import React, { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Text,
} from "@netapp/bxp-design-system-react";
import { Box } from "@components/container/index";
import { ActionsMenuCircleIcon } from "@netapp/bxp-style/react-icons/Navigation";
import { ErrorIcon } from "@netapp/bxp-style/react-icons/Notification";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { SuccessIcon } from "@netapp/bxp-style/react-icons/Notification";
import { LightBulbIcon } from "@netapp/bxp-style/react-icons/Notification";
const NoticeBoard = () => {
  return (
    <Box className="w-6/12">
      <Card>
        <CardHeader type="small">
          <CardTitle className="flex gap-3">
            <ActionsMenuCircleIcon /> Notice Board (0)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4 flex-col">
          <Box className="overflow-y-scroll px-3 h-[510px]">
            <Box className="flex items-center h-full justify-around">
              <Text className="text-gray-500">No Data Available</Text>
            </Box>
            {/* <NotificationsCard
              title="Failed Jobs/Errors(07)"
              content="Needs Attention."
              Icon={<ErrorIcon color="error" />}
            />
            <NotificationsCard
              title="Confirmation Pending (01)"
              content="Awaiting Conformation"
              Icon={<InfoIcon />}
            />
            <NotificationsCard
              title="Recently Created Jobs(02)"
              content="Migration Jobs Has been created successfully"
              Icon={<LightBulbIcon />}
            />
            <NotificationsCard
              title="Recently Completed Jobs(04)"
              content="Migration Jobs Has been completed successfully"
              Icon={<SuccessIcon color="success" />}
            /> */}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

const NotificationsCard = ({
  Icon,
  content,
  title,
}: {
  title: string;
  Icon: any;
  content: string;
}) => {
  return (
    <Box className="py-3">
      <Card>
        <Box className="p-3">
          <Box className="flex gap-3">
            {Icon}
            <Box>{title}</Box>
          </Box>
          <Box className="pl-9">{content}</Box>
        </Box>
      </Card>
    </Box>
  );
};

export default NoticeBoard;
