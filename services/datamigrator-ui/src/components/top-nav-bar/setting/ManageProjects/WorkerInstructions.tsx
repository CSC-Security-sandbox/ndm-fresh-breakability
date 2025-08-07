import { useLazyGenerateSecretForWorkerQuery } from "@api/userApi";
import { Button } from "@netapp/bxp-design-system-react";
import {
  setModalClose,
  setModalProps,
} from "@store/reducer/commonComponentSlice";
import { useDispatch } from "react-redux";
import WorkerInstallationContent from "@components/top-nav-bar/setting/ManageProjects/WorkerInstallationContent";
import { notify } from "@components/notification/NotificationWrapper.tsx";
import ErrorMessageContainer from "@components/container/ErrorMessageContainer.tsx";

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
    try {
      const generateSecretAPIResult = await generateSecretAPI({
        projectId: project_id,
      }).unwrap();
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: `Worker Installation Instructions`,
          modalContent: (
            <WorkerInstallationContent
              workerId={generateSecretAPIResult?.workerId}
              workerSecret={generateSecretAPIResult?.workerSecret}
              projectId={generateSecretAPIResult?.projectId}
              controlPlaneIp={generateSecretAPIResult?.controlPlaneIp}
              isLoading={isLoading}
              isError={isError}
            />
          ),
          modalFooter: (
            <Button onClick={() => dispatch(setModalClose())}>Close</Button>
          ),
        })
      );
    } catch (err: any) {
      notify.error(
        <ErrorMessageContainer
          title="Failed to generate worker secret."
          message={err.data.message}
        />
      );
      console.error({ err, level: "Failed to generate worker secret." });
    }
  };

  return (
    <Button onClick={showWorkerInstructions}>
      {label || "Worker Installation"}
    </Button>
  );
};

export default WorkerInstallation;
