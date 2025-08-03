import { createContext } from "react";
import { SupportBundleContextType } from "@modules/Help/components/support-bundle/types/support-bundle.types";

const SupportBundleContext = createContext<SupportBundleContextType>(
  {} as SupportBundleContextType
);

export { SupportBundleContext };
