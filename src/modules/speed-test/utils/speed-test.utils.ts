import {
  CalculateAveragePropsType,
  CalculateSpeedPropsType,
  SpeedActionType,
  SpeedDataType,
  workerErrorsPropsType,
  WorkerSpeedActionPropsType,
} from "@modules/speed-test/types/speed-test-details.types";
import { SPEED_TEST_ERROR_ENUM } from "@modules/speed-test/constants/speed-test.constants";

export const calculateAverage = ({
  worker,
  speedAction,
}: CalculateAveragePropsType) => {
  return (worker[speedAction as keyof WorkerType] as SpeedDataType[]).reduce(
    (acc, speedData) => acc + speedData?.speed,
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
      worker[speedAction as keyof SpeedActionType]?.length
    ).toFixed(2);

    const errorMessage =
      worker[SPEED_TEST_ERROR_ENUM[speedAction]]?.length > 0
        ? worker[SPEED_TEST_ERROR_ENUM[speedAction]]
        : "-";

    const formattedSpeed = isNaN(Number(averageSpeed))
      ? errorMessage
      : averageSpeed;

    return {
      workerName: worker?.workerName,
      averageSpeed: formattedSpeed,
    };
  });
};

export const calculateAverageSpeed = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const totalValue = workers.reduce((total, worker) => total + worker[type], 0);
  const averageValue = totalValue / workers?.length;

  return Number(averageValue);
};

export const workerErrors = ({ workers }: workerErrorsPropsType) => {
  return workers
    .filter(
      (worker) =>
        worker?.networkPerformanceError &&
        worker?.networkPerformanceError !== ""
    )
    .map((worker) => worker?.networkPerformanceError)
    .join(", ");
};
