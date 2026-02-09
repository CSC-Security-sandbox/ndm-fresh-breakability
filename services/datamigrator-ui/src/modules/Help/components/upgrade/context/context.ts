import { createContext } from "react";
import { UpgradeContextType } from "../types/upgrade.types";

export const UpgradeContext = createContext<UpgradeContextType>(
  {} as UpgradeContextType
);