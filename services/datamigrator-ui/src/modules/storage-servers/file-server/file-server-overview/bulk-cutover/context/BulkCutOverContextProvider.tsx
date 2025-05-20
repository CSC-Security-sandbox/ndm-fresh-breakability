import { BulkCutOverContextProviderType } from "@modules/storage-servers/file-server/file-server-overview/bulk-cutover/bulk-cutover.interface";
import { createContext } from "react";

export const BulkCutOverContext = createContext<BulkCutOverContextProviderType>(
  {} as BulkCutOverContextProviderType
);

// ! THIS IS SHARED AND MAIN FILE  WHICH IS USED IN CHILD LEVEL
const BulkCutOverContextProvider = (props: BulkCutOverContextProviderType) => {
  return (
    <BulkCutOverContext.Provider value={props}>
      {props?.children}
    </BulkCutOverContext.Provider>
  );
};

export default BulkCutOverContextProvider;
