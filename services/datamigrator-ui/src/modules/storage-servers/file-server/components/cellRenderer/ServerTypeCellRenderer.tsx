import { BlueXpTableRowType } from "@/types/app.type";

const ServerTypeCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const { row } = params;
  
  // Dell Isilon parent row - show "Dell PowerScale (Isilon)"
  if (row?._isDellIsilonParent) {
    return <div>Dell PowerScale (Isilon)</div>;
  }
  
  // Dell Isilon child row - show "Dell PowerScale (Isilon)" or the server type
  if (row?._isDellIsilonChild) {
    return <div>Dell PowerScale (Isilon)</div>;
  }
  
  return <div>{row.fileServers?.[0]?.serverType || "-"}</div>;
};

export default ServerTypeCellRenderer;
