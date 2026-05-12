/* eslint-disable */
import Box from "@components/container/Box";
import { RemoveCellRendererPropType } from "@/types/app.type";
import { Button } from "@netapp/bxp-design-system-react";
import { CloseIcon } from "@netapp/bxp-style/react-icons/Action";

const RemoveCellRenderer = ({
  deleteRow,
  disabled = false,
}: RemoveCellRendererPropType) => {
  return (
    <Box className="flex gap-2 items-center">
      <Button
        variant="icon"
        onClick={deleteRow}
        disabled={disabled}
        data-testid="remove-association"
        aria-label="Remove association"
      >
        <CloseIcon color={disabled ? "disabled" : "text"} />
      </Button>
    </Box>
  );
};

export default RemoveCellRenderer;
