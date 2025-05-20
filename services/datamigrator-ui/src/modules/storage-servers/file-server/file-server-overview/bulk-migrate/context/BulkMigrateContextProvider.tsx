import { createContext } from "react";
import {
  BulkMigrateContextProviderPropsType,
  BulkMigrateContextType,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.interface";

// DO NO CHANGE IN THIS FILE
export const BulkMigrateContext = createContext({} as BulkMigrateContextType);

const BulkMigrateContextProvider = (
  props: BulkMigrateContextProviderPropsType
) => {
  return (
    <BulkMigrateContext.Provider value={props}>
      {props?.children}
    </BulkMigrateContext.Provider>
  );
};

export default BulkMigrateContextProvider;
