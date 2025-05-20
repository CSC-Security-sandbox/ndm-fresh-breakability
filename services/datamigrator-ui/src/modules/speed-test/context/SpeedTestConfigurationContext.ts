import { createContext, useContext } from "react";
import {
  OptionsType,
  SpeedTestConfigurationType,
} from "@modules/speed-test/types/speed-test.types";
export const SpeedTestConfigurationContext = createContext(
  {} as SpeedTestConfigurationContextType
);
export const useSpeedTestConfigurationContext = () =>
  useContext(SpeedTestConfigurationContext);

export interface SpeedTestConfigurationContextType {
  speedTestConfiguration: SpeedTestConfigurationType[];
  setSpeedTestConfiguration: (arg: SpeedTestConfigurationType[]) => void;
  fileServerOptions: OptionsType[];
  setFileServerOptions: (options: OptionsType[]) => void;
  workerOptions: OptionsType[];
  setWorkerOptions: (options: OptionsType[]) => void;
  protocolOptions: OptionsType[];
  setProtocolOptions: (options: OptionsType[]) => void;
  configureSpeedTestForm: any;
  handleAddSpeedTest: () => void;
}
