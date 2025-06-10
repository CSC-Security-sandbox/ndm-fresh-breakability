import { Box } from "@components/container/index";
import {
  NoForm,
  useWizard,
  WizardContent,
  WizardLayout,
  WizardSteps,
  WizardStepTransitionRenderer,
} from "@netapp/bxp-design-system-react";

const CustomStepLayout = () => {
  const { setStep, currentStepIndex, stepPaths } = useWizard();

  return (
    <WizardLayout className="pt-6 px-8">
      <NoForm>
        <Box className="mx-auto pb-8">
          <WizardSteps
            steps={stepPaths.default}
            currentStepIndex={currentStepIndex}
            setStep={setStep}
          />
        </Box>
        <WizardContent>
          <WizardStepTransitionRenderer>
            {(Content: any) => (
              <Content />
            )}
          </WizardStepTransitionRenderer>
        </WizardContent>
      </NoForm>
    </WizardLayout>
  );
};

export default CustomStepLayout;
