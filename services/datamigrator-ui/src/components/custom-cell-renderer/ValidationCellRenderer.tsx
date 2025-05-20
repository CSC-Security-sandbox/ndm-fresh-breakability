import { ValidationCellRendererPropType } from "@/types/app.type";
import { InlineLoader, Popover } from "@netapp/bxp-design-system-react";

const ValidationCellRenderer = ({
  status,
  isLoading,
  isValidated = false,
}: ValidationCellRendererPropType) => {
  if (!isValidated) return "-";

  if (isLoading) return <InlineLoader />;

  if (status) return <Popover Trigger="success">Success</Popover>;
  return <Popover Trigger="error">Fail</Popover>;
};

export default ValidationCellRenderer;
