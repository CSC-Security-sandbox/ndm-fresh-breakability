import { BlueXpTableRowType } from "@/types/app.type";

const ServerTypeCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const { row } = params;
  return <div>{row.fileServers?.[0]?.serverType}</div>;
};

export default ServerTypeCellRenderer;
