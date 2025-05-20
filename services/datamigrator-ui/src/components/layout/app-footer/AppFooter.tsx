import { WizardFooter } from "@netapp/bxp-design-system-react";
import { ReactNode } from "react";
import { Box } from "@components/container";

interface BlueXpWizardFooterProps {
  footerContent: ReactNode;
  isCreateFirstProject?: boolean;
}

const AppFooter = ({
  footerContent,
  isCreateFirstProject,
}: BlueXpWizardFooterProps) => {
  return (
    <Box className="fixed bottom-0 h-[70px] w-full bg-inherit">
      <WizardFooter
        style={{}}
        className={`absolute bottom-0 z-50 flex justify-between overflow-hidden ${
          isCreateFirstProject ? "w-full" : "w-[calc(100vw-5rem)]"
        }`}
      >
        {footerContent}
      </WizardFooter>
    </Box>
  );
};

export default AppFooter;
