import { useCurrentTheme } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { WorkerLegendsWrapperPropsType } from "@modules/speed-test/types/speed-test-details.types";

const WorkerLegendsWrapper = ({
  workerLegends,
  colors,
}: WorkerLegendsWrapperPropsType) => {
  const tokens = useCurrentTheme().tokens;

  return (
    <Box className="flex flex-col w-3/12 items-center">
      {workerLegends.map((worker, index) => (
        <Box key={index} className="flex flex-col items-center mb-4">
          <Box className="flex flex-row items-center mb-2">
            <Box
              className="w-3 h-3 border-r-2 mr-2"
              style={{ backgroundColor: tokens[`--${colors[index]}`] }}
            ></Box>
            <Box>{worker.workerName}</Box>
          </Box>
          <Box className="flex flex-row items-center">
            <Box className="font-semibold">
              {worker.averageSpeed.toFixed(2)} Mbps
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export default WorkerLegendsWrapper;
