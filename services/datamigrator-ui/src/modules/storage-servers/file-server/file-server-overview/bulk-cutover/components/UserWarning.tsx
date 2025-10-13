import { Card, CardContent, Checkbox } from "@netapp/bxp-design-system-react";
import { UserWarningPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.interface";

const UserWarning = ({
  form,
  controlName,
  warningMessage,
}: UserWarningPropsType) => {
  return (
    <Card className="mt-3">
      <CardContent className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <Checkbox
            form={form}
            name={controlName}
            key="user-conformation"
            className="!w-5 !h-5"
          />
        </div>
        <div className="flex-1">
          {warningMessage}
        </div>
      </CardContent>
    </Card>
  );
};

export default UserWarning;
