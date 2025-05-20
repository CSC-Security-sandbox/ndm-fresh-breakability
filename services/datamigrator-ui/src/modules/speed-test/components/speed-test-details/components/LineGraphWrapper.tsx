import { LineGraph, useCurrentTheme } from "@netapp/bxp-design-system-react";
import { ChartColor } from "@netapp/bxp-design-system-react/dist/types/components/Charts/chartCommon";
import { useEffect, useState } from "react";
import { Box } from "@components/container";
import { LineGraphWrapperPropsType } from "@modules/speed-test/types/speed-test-details.types";
import WorkerLegendsWrapper from "@modules/speed-test/components/speed-test-details/components/WorkerLegendsWrapper";
import { generateColors } from "@modules/speed-test/utils/line-graph-wrapper.utils";

const LineGraphWrapper = ({
  timeStamp,
  graphData,
  workerLegends,
}: LineGraphWrapperPropsType) => {
  const tokens = useCurrentTheme().tokens;
  const [colors, setColors] = useState<string[]>([]);

  useEffect(() => {
    setColors(generateColors(workerLegends.length));
  }, [workerLegends.length]);

  return (
    <Box className="flex flex-row">
      <Box className="w-3/4">
        <LineGraph
          categories={timeStamp}
          data={graphData}
          color={colors as unknown as ChartColor[]}
          userOptions={{
            plugins: {
              tooltip: {
                caretPadding: 16,
                callbacks: {
                  label: (context: {
                    dataset: { label: string };
                    parsed: { y: string | null };
                  }) => `Speed: ${context?.parsed?.y || "-"} Mbps`,
                },
                backgroundColor: tokens["--tooltip-info-bg"],
                titleColor: tokens["--text-primary"],
                bodyColor: tokens["--text-secondary"],
                padding: 12,
              },
              legend: {
                display: false,
              },
            },
          }}
        />
      </Box>
      <WorkerLegendsWrapper workerLegends={workerLegends} colors={colors} />
    </Box>
  );
};

export default LineGraphWrapper;
