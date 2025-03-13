import { WizardFooter } from "@netapp/bxp-design-system-react";
import { ReactNode, useMemo } from "react";
import { createPortal } from "react-dom";
import { Box } from "@components/container";

interface BlueXpWizardFooterProps {
  footerContent: ReactNode;
  isCreateFirstProject?: boolean;
}

const AppFooter = ({
  footerContent,
  isCreateFirstProject = false,
}: BlueXpWizardFooterProps) => {
  const footerElement = useMemo(() => {
    return isCreateFirstProject
      ? document.getElementById("step-footer-first-project")
      : document.getElementById("step-footer");
  }, [isCreateFirstProject]);

  if (!footerElement) return <></>;

  return (
    <>
      {createPortal(
        <Box className="fixed bottom-0 h-[70px] w-full bg-inherit">
          <WizardFooter
            style={{}}
            className="absolute bottom-0 z-50 flex justify-between overflow-hidden w-[calc(100vw-5rem)]"
          >
            {footerContent}
          </WizardFooter>
        </Box>,
        footerElement
      )}
    </>
  );
};

export default AppFooter;
