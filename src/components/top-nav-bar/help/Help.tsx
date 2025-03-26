import Box from "@/components/container/Box";
import { Card, Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import { HELP_ITEMS } from "@components/top-nav-bar/help/help.constant";

const Help = () => {
  return (
    <Card className="h-full w-[40rem]">
      <Layout.Page>
        <WizardHeader Icon={HelpIcon} label="Help" />
        <Layout.Content
          style={{ padding: 20, backgroundColor: "var(--light-bg)" }}
        >
          {HELP_ITEMS.map((item) => (
            <Box
              className="flex flex-row justify-between items-center p-3 border-b cursor-pointer hover:bg-slate-100 hover:text-text-title transition-all duration-100"
              key={item.id}
            >
              {item.name}
            </Box>
          ))}
        </Layout.Content>
      </Layout.Page>
    </Card>
  );
};

export default Help;
