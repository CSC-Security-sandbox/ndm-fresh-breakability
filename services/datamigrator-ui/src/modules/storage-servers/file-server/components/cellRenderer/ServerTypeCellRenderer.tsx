import { BlueXpTableRowType } from "@/types/app.type";

const ServerTypeCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const { row } = params;
  
  // Dell Isilon parent row - show "Dell Isilon"
  if (row?._isDellIsilonParent) {
    return <div>Dell Isilon</div>;
  }
  
  // Dell Isilon child row - show "Dell Isilon" or the server type
  if (row?._isDellIsilonChild) {
    return <div>Dell Isilon</div>;
  }
  
  return <div>{row.fileServers?.[0]?.serverType || "-"}</div>;
};

export default ServerTypeCellRenderer;
