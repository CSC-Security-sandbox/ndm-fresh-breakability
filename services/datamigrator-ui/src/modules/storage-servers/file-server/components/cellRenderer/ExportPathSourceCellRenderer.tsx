import { BlueXpTableRowType, ConfigListTypeApiType } from "@/types/app.type";
import { FILE_SERVER_LIST_ENUM } from "@modules/storage-servers/file-server/file-server.constant";
import { memo } from "react";

const ExportPathSourceCellRenderer = (
  props: BlueXpTableRowType<ConfigListTypeApiType, ConfigListTypeApiType>
) => {
  return (
    <> {FILE_SERVER_LIST_ENUM[props?.row?.fileServers[0]?.exportPathSource]}</>
  );
};

export default memo(ExportPathSourceCellRenderer);
