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
    <WizardLayout className="pt-6px-8">
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
              <Box className="flex flex-col items-center justify-center h-full">
                <Content />
              </Box>
            )}
          </WizardStepTransitionRenderer>
        </WizardContent>
      </NoForm>
    </WizardLayout>
  );
};

export default CustomStepLayout;
