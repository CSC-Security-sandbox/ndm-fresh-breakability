import Box from "@/components/container/Box";
import { Card, Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import { HELP_ITEMS } from "@components/top-nav-bar/help/help.constant";
import { useState } from "react";
import AboutNDM from "@components/top-nav-bar/help/about_ndm.tsx";
import { Collapse } from "@mui/material";


const Help = () => {
    console.log("HelpItems ", HELP_ITEMS);
  const [isHelpListVisible, setIsHelpListVisible] =
    useState<boolean>(true);
  const handleClose = () => {
    setIsHelpListVisible(true);
  };
  return (
    <>
    <Collapse in={isHelpListVisible} mountOnEnter unmountOnExit>
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
              onClick={() => setIsHelpListVisible(item.id !== 1)}
              >
               {item.name}
               </Box>
                ))}
        </Layout.Content>
      </Layout.Page>
    </Card>
    </Collapse>
  <Collapse in={!isHelpListVisible} mountOnEnter unmountOnExit>
    <Box className="flex justify-around">
      <AboutNDM closeAction={handleClose}></AboutNDM>
    </Box>
  </Collapse>
    </>
  );
};

export default Help;
