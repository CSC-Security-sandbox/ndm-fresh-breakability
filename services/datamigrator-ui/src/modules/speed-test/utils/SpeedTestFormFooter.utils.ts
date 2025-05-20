import {
  TestType,
  TransformedDataPropsType,
} from "@modules/speed-test/types/speed-test.types";

const getTestTypes = (tests: TestType[]) => {
  return {
    readTest: tests.some((test) => test.value === "read"),
    writeTest: tests.some((test) => test.value === "write"),
    networkPerformance: tests.some(
      (test) => test.value === "networkPerformance"
    ),
  };
};

export const transformData = ({
  speedTestConfigurationData,
  projectId,
}: TransformedDataPropsType) => {
  const speedTests = speedTestConfigurationData.map((item) => {
    const { protocol, workers, tests } = item;
    const fileServer = protocol[0]?.value;
    const protocolLabel = protocol[0]?.label;

    const workerIds = workers.map((worker) => worker.value);

    const test = getTestTypes(tests);

    return {
      fileServer,
      protocol: protocolLabel,
      workers: workerIds,
      test,
    };
  });

  return {
    speedTests,
    createdBy: projectId,
  };
};
