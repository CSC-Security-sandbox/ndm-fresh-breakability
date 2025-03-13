import {
  CalculateAveragePropsType,
  CalculateSpeedPropsType,
  SpeedActionType,
  SpeedDataType,
  WorkerSpeedActionPropsType,
} from "@modules/speed-test/types/speed-test-details.types";

export const calculateAverage = ({
  worker,
  speedAction,
}: CalculateAveragePropsType) => {
  return (worker[speedAction as keyof WorkerType] as SpeedDataType[]).reduce(
    (acc, speedData) => acc + speedData.speed,
    0
  );
};

export const calculateAverageSpeedOfWorkers = ({
  workers,
  speedAction,
}: WorkerSpeedActionPropsType) => {
  return workers.map((worker) => {
    const totalSpeedAsPerAction = calculateAverage({ worker, speedAction });
    const averageSpeed = (
      totalSpeedAsPerAction /
      worker[speedAction as keyof SpeedActionType].length
    ).toFixed(2);
    return {
      workerName: worker.workerName,
      averageSpeed,
    };
  });
};

export const calculateOverallAverageSpeed = ({
  workers,
  speedAction,
}: WorkerSpeedActionPropsType) => {
  const averageSpeedOfWorkers = calculateAverageSpeedOfWorkers({
    workers,
    speedAction,
  });
  const totalSpeedOfWorkers = averageSpeedOfWorkers.reduce(
    (sum, worker) => sum + Number(worker.averageSpeed),
    0
  );
  const overallAverageSpeed =
    totalSpeedOfWorkers / averageSpeedOfWorkers.length;
  return Number(overallAverageSpeed.toFixed(2));
};

export const calculateAverageSpeed = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const totalValue = workers.reduce((total, worker) => total + worker[type], 0);
  const averageValue = totalValue / workers.length;

  return Number(averageValue);
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

//Dynamic color generation
export const generateColors = (numColors: number) => {
  const colors = [
    "chart-9-gradient",
    "icon-primary",
    "chart-5",
    "chart-4",
    "chart-8",
    "chart-7",
    "chart-2",
    "chart-3",
    "chart-6",
    "chart-10",
  ];
  return colors.slice(0, numColors);
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
