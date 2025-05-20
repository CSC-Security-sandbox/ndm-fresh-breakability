import { Box } from "@components/container/index";
import SpeedTestConfigurationTable from "@modules/speed-test/components/speed-test-configuration/components/SpeedTestConfigurationTable";
import AppFooter from "@/components/layout/app-footer/AppFooter";
import SpeedTestConfigurationForm from "@modules/speed-test/components/speed-test-configuration/components/SpeedTestConfigurationForm";
import SpeedTestFormFooter from "@modules/speed-test/components/speed-test-configuration/components/SpeedTestFormFooter";
import { SpeedTestConfigurationContext } from "@/modules/speed-test/context/SpeedTestConfigurationContext";
import useSpeedTestConfigurationForm from "@/modules/speed-test/hooks/useSpeedTestConfigurationForm";

const SpeedTestConfig = () => {
  const speedTestConfig = useSpeedTestConfigurationForm();
  return (
    <SpeedTestConfigurationContext.Provider value={speedTestConfig}>
      {/* FORM */}
      <Box className="w-full p-6">
        <SpeedTestConfigurationForm />
        <SpeedTestConfigurationTable />
      </Box>

      {/* FOOTER */}
      <AppFooter footerContent={<SpeedTestFormFooter />} />
    </SpeedTestConfigurationContext.Provider>
  );
};

export default SpeedTestConfig;
