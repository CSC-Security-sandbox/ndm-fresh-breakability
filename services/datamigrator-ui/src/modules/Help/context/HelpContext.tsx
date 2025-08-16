import { createContext, useState, ReactNode } from "react";
import { HelpContextType } from "@modules/Help/types/help.types";

export const HelpContext = createContext<HelpContextType | null>(null);

export const HelpProvider = ({ children }: { children: ReactNode }) => {
  const [isHelpListVisible, setIsHelpListVisible] = useState<boolean>(true);
  const [getItemIndex, setGetItemIndex] = useState<number>(0);

  return (
    <HelpContext.Provider
      value={{
        isHelpListVisible,
        setIsHelpListVisible,
        getItemIndex,
        setGetItemIndex,
      }}
    >
      {children}
    </HelpContext.Provider>
  );
};
