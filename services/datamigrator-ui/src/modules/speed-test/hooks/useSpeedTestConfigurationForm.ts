import { useCallback, useEffect, useState } from "react";
import { useForm } from "@netapp/bxp-design-system-react";
import { SPEED_TEST_FORM_SCHEMA } from "@modules/speed-test/constants/useSpeedTestConfigurationForm.constants";
import { useGetSpeedTestFileServersQuery } from "@api/configApi";
import { JOB_CONFIG_STATUS_ENUM } from "@/types/app.type";
import {
  ConfigDetailsType,
  ItemType,
  OptionsType,
  SpeedTestConfigType,
  SpeedTestConfigurationType,
} from "@modules/speed-test/types/speed-test.types";
import {
  CONFIGURE_SPEED_TEST_SCHEMA,
  SPEED_TEST_TOOLTIP,
} from "@modules/speed-test/constants/speed-test.constants";

const useSpeedTestConfigurationForm = () => {
  const [speedTestConfiguration, setSpeedTestConfiguration] = useState<
    SpeedTestConfigurationType[]
  >([]);
  const [fileServerOptions, setFileServerOptions] = useState<OptionsType[]>([]);
  const [workerOptions, setWorkerOptions] = useState<OptionsType[]>([]);
  const [protocolOptions, setProtocolOptions] = useState<OptionsType[]>([]);
  const [configDetails, setConfigDetails] = useState<ConfigDetailsType[]>([]);

  const configureSpeedTestForm = useForm(
    SPEED_TEST_FORM_SCHEMA,
    CONFIGURE_SPEED_TEST_SCHEMA
  );

  const { data: configurationData } = useGetSpeedTestFileServersQuery();

  const isFileServerConfigAvailable = (configData) => {
    return (
      configData?.hasScratchPath &&
      configData?.status === JOB_CONFIG_STATUS_ENUM.ACTIVE
    );
  };

  //Create config form data
  useEffect(() => {
    if (configurationData) {
      const fileServerOptions = configurationData.map(
        (configData: SpeedTestConfigType) => ({
          label: configData?.serverName,
          value: configData?.id,
          isDisabled: !isFileServerConfigAvailable(configData),
          tooltip: isFileServerConfigAvailable(configData)
            ? ""
            : SPEED_TEST_TOOLTIP,
        })
      );
      const configDetails = configurationData.map(
        (configData: SpeedTestConfigType) => ({
          id: configData.id,
          protocol: configData?.fileServers.map((server) => ({
            label: server?.protocol,
            value: server?.id,
          })),
          workers: configData?.fileServers
            .map((server) =>
              server.workers.map((worker) => ({
                label: worker.workerName,
                value: worker.id,
              }))
            )
            .flat(),
        })
      );

      setFileServerOptions(fileServerOptions);
      setConfigDetails(configDetails);
    }
  }, [configurationData]);

  // Update form state based on selected file server config
  useEffect(() => {
    if (configureSpeedTestForm?.formState?.fileServer !== "") {
      configDetails.map((configData) => {
        if (
          configData?.id ===
          configureSpeedTestForm?.formState?.fileServer?.value
        ) {
          setProtocolOptions(configData.protocol);
          setWorkerOptions(configData.workers);
        }
      });
      configureSpeedTestForm.resetForm({
        fileServer: configureSpeedTestForm?.formState?.fileServer,
        protocol: protocolOptions,
        workers: [],
        tests: [],
      });
    }
  }, [configureSpeedTestForm?.formState?.fileServer, protocolOptions]);

  // Sort Config form data as per protocol, Add new speed test configuration and reset form
  const handleAddSpeedTest = useCallback(() => {
    const dataAsPerProtocol = configureSpeedTestForm?.formState?.protocol.map(
      (protocol: string) => ({
        ...configureSpeedTestForm.formState,
        protocol: [protocol],
      })
    );

    setSpeedTestConfiguration((prev) => {
      const updatedConfig = prev.filter((item) => {
        const isMatch = dataAsPerProtocol.some((protocolItem: ItemType) => {
          const isProtocolMatch = item?.protocol.some((itemProtocol) =>
            protocolItem.protocol.some(
              (formStateProtocol) =>
                itemProtocol.value === formStateProtocol.value
            )
          );
          return (
            item?.fileServer?.value === protocolItem?.fileServer?.value &&
            isProtocolMatch
          );
        });

        return !isMatch;
      });

      return [...updatedConfig, ...dataAsPerProtocol];
    });

    configureSpeedTestForm.resetForm(SPEED_TEST_FORM_SCHEMA);
  }, [configureSpeedTestForm]);

  return {
    speedTestConfiguration,
    setSpeedTestConfiguration,
    fileServerOptions,
    setFileServerOptions,
    workerOptions,
    setWorkerOptions,
    protocolOptions,
    setProtocolOptions,
    configureSpeedTestForm,
    handleAddSpeedTest,
  };
};

export default useSpeedTestConfigurationForm;
