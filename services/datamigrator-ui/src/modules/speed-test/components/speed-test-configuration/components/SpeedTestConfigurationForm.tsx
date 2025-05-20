import { Box } from "@components/container";
import { Button, FormFieldSelect } from "@netapp/bxp-design-system-react";
import { AddIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { useSpeedTestConfigurationContext } from "@modules/speed-test/context/SpeedTestConfigurationContext";
import SpeedTestAccordion from "@modules/speed-test/components/speed-test-configuration/components/SpeedTestAccordion";
import { SPEED_TEST_OPTIONS } from "@modules/speed-test/constants/speed-test.constants";

const SpeedTestConfigurationForm = () => {
  const {
    fileServerOptions,
    workerOptions,
    protocolOptions,
    configureSpeedTestForm,
    handleAddSpeedTest,
  } = useSpeedTestConfigurationContext();

  return (
    <SpeedTestAccordion>
      <Box className="flex gap-3">
        <Box className="w-full">
          <FormFieldSelect
            label="Select File Server"
            placeholder="Select File Server"
            name="fileServer"
            form={configureSpeedTestForm}
            options={fileServerOptions}
          />
          <FormFieldSelect
            label="Workers"
            placeholder="Select Workers"
            name="workers"
            form={configureSpeedTestForm}
            options={workerOptions}
            isSearchable={true}
            isMulti={true}
          />
        </Box>
        <Box className="w-full">
          <FormFieldSelect
            label="Select Protocol"
            placeholder="Select Protocol"
            name="protocol"
            form={configureSpeedTestForm}
            options={protocolOptions}
            isMulti={true}
          />
          <FormFieldSelect
            label="Tests"
            placeholder="Select Tests"
            name="tests"
            form={configureSpeedTestForm}
            options={SPEED_TEST_OPTIONS}
            isMulti={true}
          />
        </Box>
      </Box>
      <Box className="flex justify-end">
        <Button
          onClick={handleAddSpeedTest}
          disabled={!configureSpeedTestForm.isValid}
        >
          <Box className="flex items-stretch">
            <AddIcon fontSize="small" size="20" />
            Add
          </Box>
        </Button>
      </Box>
    </SpeedTestAccordion>
  );
};

export default SpeedTestConfigurationForm;
