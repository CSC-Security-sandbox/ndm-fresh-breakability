import { Card, CardHeader, CardTitle } from "@netapp/bxp-design-system-react";
import { ActionsMenuCircleIcon } from "@netapp/bxp-style/react-icons/Navigation";
import { useState } from "react";
import NotificationsContent from "@modules/home/components/NotificationsContent";

const NoticeBoard = () => {
  const [totalNotifications, setTotalNotifications] = useState<number>(0);
  return (
    <Card className="w-6/12">
      <CardHeader type="small">
        <CardTitle className="flex gap-3">
          <ActionsMenuCircleIcon /> Notice Board ({totalNotifications})
        </CardTitle>
      </CardHeader>
      <NotificationsContent setTotalNotifications={setTotalNotifications} />
    </Card>
  );
};

export default NoticeBoard;
