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

export const calculateAverageSpeed = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const totalValue = workers.reduce((total, worker) => total + worker[type], 0);
  const averageValue = totalValue / workers.length;

  return Number(averageValue);
};
