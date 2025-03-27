import Box from "@components/container/Box";

type ErrorMessageContainerType = {
  title: string;
  message: string;
};

const ErrorMessageContainer = ({
  title,
  message,
}: ErrorMessageContainerType) => (
  <Box className="flex flex-col gap-2">
    <Box>{title}</Box>
    <Box>Reason: {message}`</Box>
  </Box>
);

export default ErrorMessageContainer;
