import Box from "@components/container/Box";
import { Text } from "@netapp/bxp-design-system-react";
import { NoticeTriangleIcon } from "@netapp/bxp-style/react-icons/Notification";
import { ChartErrorPropsType } from "@/types/app.type";

const ChartError = ({ children, hideErrorIcon }: ChartErrorPropsType) => {
  return (
    <Box className="flex gap-2 items-center justify-center">
      {!hideErrorIcon && <NoticeTriangleIcon color="error" />}
      <Text>{children}</Text>
    </Box>
  );
};

export default ChartError;
