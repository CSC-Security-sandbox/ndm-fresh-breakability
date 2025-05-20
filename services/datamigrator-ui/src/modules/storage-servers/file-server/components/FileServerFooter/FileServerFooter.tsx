import { Box } from "@components/container/index";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import { ReactNode, useContext } from "react";
import NextAndSubmitButton from "@modules/storage-servers/file-server/components/FileServerFooter/NextAndSubmitButton";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";

const FileServerFooter = ({ content }: { content?: ReactNode }) => {
  const navigate = useNavigate();
  const { currentStepIndex, gotoPreviousStep } = useWizard();
  const { setDisableNextButton } = useContext(CommonFileServerContext);

  const handleCancel = () => {
    navigate("/file-server");
  };

  const handleBack = () => {
    gotoPreviousStep();
    setDisableNextButton(false);
  };

  return (
    <Box className="py-4 flex justify-center">
      <Box>{content}</Box>
      <Box className="flex justify-end gap-4">
        <Button
          color="secondary"
          onClick={handleBack}
          disabled={currentStepIndex === 0}
          style={{ width: 152 }}
        >
          Back
        </Button>
        <Button color="secondary" onClick={handleCancel} style={{ width: 152 }}>
          Cancel
        </Button>
        <NextAndSubmitButton />
      </Box>
    </Box>
  );
};

export default FileServerFooter;
