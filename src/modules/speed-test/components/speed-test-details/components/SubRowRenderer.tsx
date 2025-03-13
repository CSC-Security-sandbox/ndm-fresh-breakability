import { FormFieldSelect } from "@netapp/bxp-design-system-react";
import { SubRowRendererPropsType } from "@modules/speed-test/types/speed-test.types";
import { useSpeedTestTableData } from "@modules/speed-test/hooks/useSpeedTestTableData";
import { SPEED_TEST_TABLE_OPTIONS } from "@modules/speed-test/constants/speed-test.constants";
import { memo, useEffect } from "react";
import {
  calculateAverageSpeedOfWorkers,
  lineGraphProcessData,
} from "@modules/speed-test/utils/speed-test-details.utils";
import { SpeedActionType } from "@modules/speed-test/types/speed-test-details.types";
import { Box } from "@components/container";
import LineGraphWrapper from "@modules/speed-test/components/speed-test-details/components/LineGraphWrapper";

const SubRowRenderer = ({
  row,
  rowSelections,
  handleChange,
}: SubRowRendererPropsType) => {
  const {
    timeStamp,
    setTimestamp,
    graphData,
    SetGraphData,
    workerLegends,
    SetWorkerLegends,
  } = useSpeedTestTableData();

  const selectedRowOption =
    rowSelections[row.id] || SPEED_TEST_TABLE_OPTIONS[0].value;
  const selectedOption = SPEED_TEST_TABLE_OPTIONS.find(
    (option) => option.value === selectedRowOption
  );
  const selectedLabel = selectedOption ? selectedOption.label : "";

  useEffect(() => {
    const { uniqueSortedTimeStamps, graphData } = lineGraphProcessData({
      workers: row.workers,
      speedAction: selectedRowOption as keyof SpeedActionType,
    });
    setTimestamp(uniqueSortedTimeStamps);
    SetGraphData(graphData);
    SetWorkerLegends(
      calculateAverageSpeedOfWorkers({
        workers: row.workers,
        speedAction: selectedRowOption as keyof SpeedActionType,
      })
    );
  }, [selectedRowOption]);

  return (
    <Box className="w-full p-5 bg-white border-b-2">
      <Box className="flex flex-col space-y-4">
        <Box className="w-2/6">
          <FormFieldSelect
            name="speedTestName"
            options={SPEED_TEST_TABLE_OPTIONS}
            value={selectedOption}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              handleChange(row.id, e)
            }
          />
        </Box>
        <Box className="text-sm">{selectedLabel} (In Mbps)</Box>
        {graphData.length > 0 && (
          <LineGraphWrapper
            timeStamp={timeStamp}
            graphData={graphData}
            workerLegends={workerLegends}
          />
        )}
        <Box className="flex justify-center text-sm">Time (In Minutes)</Box>
      </Box>
    </Box>
  );
};

export default memo(SubRowRenderer);
