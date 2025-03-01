import { WizardFooter } from "@netapp/bxp-design-system-react";
import { ReactNode } from "react";

interface BlueXpWizardFooterProps {
  footerContent: ReactNode;
}

const AppFooter = ({ footerContent }: BlueXpWizardFooterProps) => {
  return (
    <WizardFooter
      style={{}}
      className="absolute bottom-0 z-50 flex justify-between overflow-hidden w-full"
    >
      {footerContent}
    </WizardFooter>
  );
};

export default AppFooter;
