import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { useLazyGetUniqueFileServerNamesQuery } from "@api/configApi";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { notify } from "@components/notification/NotificationWrapper";

const STEP_0_FILE_SERVER_NAME = 0;
const STEP_1_CREDENTIALS = 1;
const STEP_2_WORKERS = 2;
const STEP_3_WORKING_DIRECTORY = 3;

const NextAndSubmitButton = () => {
  const { currentStepIndex, goToNextStep } = useWizard();
  const [getUniqueFileServerName] = useLazyGetUniqueFileServerNamesQuery();
  const { selectedProjectId } = useSelectedProjectId();

  const {
    handleEditConfiguration,
    handleCreateConfiguration,
    handleValidateConnection,
    serverTypeForm,
    selectedWorkerIds,
    nfsCredentialsForm,
    smbCredentialsForm,
    hostCredentialsForm,
    fileServerId,
    isEditMode,
    validateConnectionLoader,
    disableNextButton,
    nfsValidatedWorkersIds,
    editingFileServerDetails,
  } = useContext(CommonFileServerContext);

  const handleFinish = async () => {
    if (isEditMode) {
      handleEditConfiguration();
    } else {
      handleCreateConfiguration();
    }
  };

  const getDisableStatus = () => {
    switch (currentStepIndex) {
      case STEP_0_FILE_SERVER_NAME: {
        const isFormValid = serverTypeForm.isValid;
        const isFormDirty = serverTypeForm.dirty;

        if (fileServerId !== null) {
          return !isFormValid;
        }
        return !(isFormValid && isFormDirty);
      }

      case STEP_1_CREDENTIALS: {
        const isHostValid = hostCredentialsForm.isValid;
        const isNfsValid = nfsCredentialsForm.isValid;
        const isSmbValid = smbCredentialsForm.isValid;

        return !isHostValid || (!isNfsValid && !isSmbValid);
      }

      case STEP_2_WORKERS: {
        return false;
      }

      case STEP_3_WORKING_DIRECTORY: {
        return false;
      }

      default:
        return false;
    }
  };

  const handleProceed = () => {
    const isConfigNameChanged =
      editingFileServerDetails?.configName !==
      serverTypeForm?.formState?.configName;

    const isFirstStep = currentStepIndex === STEP_0_FILE_SERVER_NAME;

    if (isFirstStep) {
      if (!isEditMode) {
        checkUniqueFileServerName();
        return;
      }

      if (isEditMode && isConfigNameChanged) {
        checkUniqueFileServerName();
        return;
      }
    }

    handleNextClick();
  };

  const checkUniqueFileServerName = async () => {
    if (
      currentStepIndex === STEP_0_FILE_SERVER_NAME &&
      serverTypeForm?.formState?.configName
    ) {
      try {
       let result = await getUniqueFileServerName({
          projectId: selectedProjectId,
          configName: serverTypeForm?.formState?.configName,
        }).unwrap();
       console.log('call inside the handle check server name', result);
        handleNextClick();
      } catch (err) {
        console.log(err?.data?.message || "File Server creation error");
        notify.error(err?.data?.message);
      }
    }
  };

  const handleNextClick = async () => {
    if (selectedWorkerIds?.length === 0) {
      goToNextStep();
    } else if (currentStepIndex === 2) {
      const selectedSet = new Set(selectedWorkerIds);
      const validatedSet = new Set(nfsValidatedWorkersIds);

      const areIdsEqual =
        selectedSet.size === validatedSet.size &&
        Array.from(selectedSet).every((id) => validatedSet.has(id));

      if (areIdsEqual) {
        goToNextStep();
      } else {
        const resp = await handleValidateConnection();
        if (resp.errorMessageList.length === 0) {
          goToNextStep();
        }
      }
    } else {
      goToNextStep();
    }
  };

  return (
    <>
      {currentStepIndex === 3 ? (
        <Button
          onClick={handleFinish}
          style={{ width: 152 }}
          isSubmitting={validateConnectionLoader || disableNextButton}
        >
          Finish
        </Button>
      ) : (
        <Button
          onClick={handleProceed}
          disabled={getDisableStatus()}
          isSubmitting={validateConnectionLoader}
          style={{ width: 152 }}
        >
          Proceed
        </Button>
      )}
    </>
  );
};

export default NextAndSubmitButton;
