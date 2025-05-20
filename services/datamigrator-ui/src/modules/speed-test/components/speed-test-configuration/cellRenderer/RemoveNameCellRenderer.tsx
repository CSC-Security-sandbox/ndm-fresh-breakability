import { CloseIcon } from "@netapp/bxp-style/react-icons/Action";
import { useContext } from "react";
import { Button } from "@netapp/bxp-design-system-react";
import { SpeedTestConfigurationContext } from "@modules/speed-test/context/SpeedTestConfigurationContext";
import { SpeedTestConfigurationType } from "@modules/speed-test/types/speed-test.types";

const RemoveNameCellRenderer = ({
  row,
}: {
  row: SpeedTestConfigurationType;
}) => {
  const { speedTestConfiguration, setSpeedTestConfiguration } = useContext(
    SpeedTestConfigurationContext
  );

  const handleRemoveFileServer = () => {
    const filteredSpeedTest = speedTestConfiguration.filter((configData) => {
      const fileServerMatch =
        configData?.fileServer?.value === row?.fileServer?.value;
      const protocolMatch = row?.protocol.every((protocol) =>
        configData?.protocol.some((p) => p?.value === protocol?.value)
      );
      return !(fileServerMatch && protocolMatch);
    });
    setSpeedTestConfiguration(filteredSpeedTest);
  };

  return (
    <Button
      variant="icon"
      className="pr-4 ml-auto"
      onClick={handleRemoveFileServer}
    >
      <CloseIcon color="text" />
    </Button>
  );
};

export default RemoveNameCellRenderer;
