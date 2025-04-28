import { Box } from "@components/container";

const ValueCellRenderer = ({ value }) => {
  return <Box>{value !== null && value !== undefined ? value : "-"}</Box>;
};

export default ValueCellRenderer;
