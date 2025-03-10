import { TransformedDataPropsType } from "@modules/speed-test/types/speed-test.types";

export const transformData = ({
  speedTestConfigurationData,
  projectId,
}: TransformedDataPropsType) => {
  const speedTests = speedTestConfigurationData.map((item) => {
    const fileServer = item.protocol[0].value;
    const protocol = item.protocol[0]?.label;
    const workers = item.workers.map((worker) => worker.value);

    const readTest = item.tests.some((test) => test.value === "read");
    const writeTest = item.tests.some((test) => test.value === "write");
    const networkPerformance = item.tests.some(
      (test) => test.value === "networkPerformance"
    );

    const test = {
      readTest,
      writeTest,
      networkPerformance,
    };

    return {
      fileServer,
      protocol,
      workers,
      test,
    };
  });

  return {
    speedTests,
    createdBy: projectId,
  };
};
