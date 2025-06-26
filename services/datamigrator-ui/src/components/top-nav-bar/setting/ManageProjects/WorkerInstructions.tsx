import { useLazyGenerateSecretForWorkerQuery } from "@api/userApi";
import { Button } from "@netapp/bxp-design-system-react";
import {
  setModalClose,
  setModalProps,
} from "@store/reducer/commonComponentSlice";
import { useDispatch } from "react-redux";
import WorkerInstallationContent from "@components/top-nav-bar/setting/ManageProjects/WorkerInstallationContent";

const WorkerInstallation = ({
  label,
  project_id,
}: {
  label: string;
  project_id: string;
}) => {
  const dispatch = useDispatch();
  const [generateSecretAPI, { isLoading, isError }] =
    useLazyGenerateSecretForWorkerQuery();

  const showWorkerInstructions = async () => {
    const generateSecretAPIResult = await generateSecretAPI({
      projectId: project_id,
    }).unwrap();
    const data = generateSecretAPIResult?.data?.items;
    dispatch(
      setModalProps({
        isOpen: true,
        modalHeader: `Worker Installation Instructions`,
        modalContent: (
          <WorkerInstallationContent
            workerId={data?.workerId}
            workerSecret={data?.workerSecret}
            controlPlaneIp={data?.controlPlaneIp}
            isLoading={isLoading}
            isError={isError}
          />
        ),
        modalFooter: (
          <Button onClick={() => dispatch(setModalClose())}>Close</Button>
        ),
      }),
    );
  };

  return (
    <Button onClick={showWorkerInstructions} className="ml-4">
      {label || "Worker Installation"}
    </Button>
  );
};

export default WorkerInstallation;
