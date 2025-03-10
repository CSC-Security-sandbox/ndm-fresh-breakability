import { Box } from "@components/container/index";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import NextAndSubmitButton from "./NextAndSubmitButton";

const Footer = ({ content }: { content?: ReactNode }) => {
  const navigate = useNavigate();
  const { currentStepIndex, gotoPreviousStep } = useWizard();

  const handleCancel = () => {
    navigate("/file-server");
  };

  return (
    <Box className="py-4 flex justify-center">
      <Box>{content}</Box>
      <Box className="flex justify-end gap-4">
        <Button
          color="secondary"
          onClick={gotoPreviousStep}
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

export default Footer;
