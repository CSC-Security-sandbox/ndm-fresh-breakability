import { JobRowType } from "@/types/app.type";

export const getJobListFlaternList = (list: JobRowType[]) => {
  return list.map((row) => ({
    ...row,
    sourceServerName: row.sourceServer.serverName,
    sourceServerProtocol: row.sourceServer.protocol,
    destinationServerName: row.destinationServer.serverName || "",
  }));
};
