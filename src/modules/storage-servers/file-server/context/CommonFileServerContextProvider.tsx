import { createContext } from "react";
import { CommonFileServerContextProviderType } from "@modules/storage-servers/file-server//fileServer.interface";

export const CommonFileServerContext =
  createContext<CommonFileServerContextProviderType>(
    {} as CommonFileServerContextProviderType
  );

// ! THIS IS SHARED AND MAIN FILE  WHICH IS USED IN CHILD LEVEL
const CommonFileServerContextProvider = ({
  ...props
}: CommonFileServerContextProviderType) => {
  return (
    <CommonFileServerContext.Provider
      value={{
        ...props,
      }}
    >
      {props?.children}
    </CommonFileServerContext.Provider>
  );
};

export default CommonFileServerContextProvider;
