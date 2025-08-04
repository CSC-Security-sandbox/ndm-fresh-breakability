import React from "react";
import { Card, Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useDrawerNavigation } from "@hooks/useDrawerNavigation";
import Help from "@modules/Help/Help";

interface HelpDrawerLayoutProps {
  label: string;
  children: React.ReactNode;
  width?: string;
  contentClassName?: string;
  Icon?: React.ComponentType<any>;
}

const HelpDrawerLayout: React.FC<HelpDrawerLayoutProps> = ({
  label,
  children,
  width = "40rem",
  contentClassName = "p-10",
  Icon = InfoIcon,
}) => {
  const { handleCloseDrawer } = useDrawerNavigation("help", <Help />);

  return (
    <Card className={`h-full w-[${width}]`}>
      <Layout.Page>
        <WizardHeader
          logo={null}
          Icon={Icon}
          label={label}
          children={null}
          onClose={handleCloseDrawer}
          closeLink=""
          Widgets={null}
        />
        <Layout.Content className={contentClassName}>{children}</Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default HelpDrawerLayout;
