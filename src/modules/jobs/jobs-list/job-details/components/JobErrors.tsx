import {
  Card,
  Text,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  // Notification,
} from "@netapp/bxp-design-system-react";
import {
  NoticeTriangleIcon,
  SuccessIcon,
} from "@netapp/bxp-style/react-icons/Notification";

const JobErrors = () => {
  const errorCount: number = 0;
  const hasErrors = errorCount !== 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex gap-4">
          {hasErrors ? (
            <NoticeTriangleIcon color="error" />
          ) : (
            <SuccessIcon color="success" />
          )}

          <Text>Errors ({errorCount})</Text>
        </CardTitle>
        <Button
          onClick={() => {}}
          color="secondary"
          style={{ margin: "0 0 0 auto" }}
          disabled={!hasErrors}
        >
          View All
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <></>
        {/* <Notification type="error" moreInfo="Here is some more info">
          Fatal Errors
        </Notification>
        <Notification type="warning" moreInfo="Here is some more info">
          Transient Errors
        </Notification>
        <Notification type="info" moreInfo="Here is some more info">
          Recoverable Errors
        </Notification> */}
      </CardContent>
    </Card>
  );
};

export default JobErrors;
