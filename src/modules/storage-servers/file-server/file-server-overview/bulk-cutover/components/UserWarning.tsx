import { Card, CardContent, Checkbox } from "@netapp/bxp-design-system-react";
import { UserWarningPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.interface";

const UserWarning = ({
  form,
  controlName,
  warningMessage,
}: UserWarningPropsType) => {
  return (
    <Card className="mt-3">
      <CardContent className="flex gap-4 flex-col">
        <Checkbox form={form} name={controlName} key="user-conformation">
          {warningMessage}
        </Checkbox>
      </CardContent>
    </Card>
  );
};

export default UserWarning;
