import {
  CalculateSpeedPropsType,
  SpeedActionType,
  WorkerSpeedActionPropsType,
} from "@modules/speed-test/types/speed-test-details.types";
import {
  calculateAverageSpeed,
  calculateAverageSpeedOfWorkers,
} from "@modules/speed-test/utils/speed-test.utils";

export const calculateOverallAverageSpeed = ({
  workers,
  speedAction,
}: WorkerSpeedActionPropsType) => {
  const averageSpeedOfWorkers = calculateAverageSpeedOfWorkers({
    workers,
    speedAction,
  });
  const filteredSpeed = averageSpeedOfWorkers.filter(
    (worker) => !isNaN(Number(worker.averageSpeed))
  );
  const totalSpeedOfWorkers = filteredSpeed.reduce(
    (sum, worker) => sum + Number(worker.averageSpeed),
    0
  );

  const overallAverageSpeed = totalSpeedOfWorkers / filteredSpeed.length;
  return Number(overallAverageSpeed.toFixed(2));
};

export const lineGraphProcessData = ({
  workers,
  speedAction,
}: WorkerSpeedActionPropsType) => {
  // Extract speeds based on the selected row option
  const speedTestOptionData = workers.map(
    (worker) => worker[speedAction as keyof SpeedActionType]
  );

  // Flatten the array and extract unique sorted timestamps
  const allTimeStamps = speedTestOptionData
    .flat()
    .map((data) => data.timeStamp);

  const uniqueSortedTimeStamps = Array.from(new Set(allTimeStamps))
    .sort((a, b) => a - b)
    .map((timestamp) => parseInt(timestamp.toString()).toString());

  // Extract speeds for the graph data
  const graphData = speedTestOptionData.map((speedArray) =>
    speedArray.map((data) => data.speed)
  );

  return { uniqueSortedTimeStamps, graphData };
};

export const percentageFormatter = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const averageValue = calculateAverageSpeed({
    workers,
    type,
  });

  return Number((averageValue / 100).toFixed(2));
};
