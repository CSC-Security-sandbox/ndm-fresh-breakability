import { useContext } from "react";
import { Collapse } from "@mui/material";
import { Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import Box from "@/components/container/Box";
import RenderEach from "@components/render-each/RenderEach.tsx";
import { HelpProvider, HelpContext } from "@modules/Help/context/HelpContext";
import { HELP_ITEMS } from "@modules/Help/constants/help.constants";
import { useHelpContent } from "@modules/Help/hook/useHelpContent";

const HelpContent = () => {
  const { isHelpListVisible, setGetItemIndex } = useContext(HelpContext);

  useHelpContent();

  return (
    <Collapse in={isHelpListVisible} mountOnEnter unmountOnExit>
      <Layout.Page>
        <WizardHeader
          logo={null}
          Icon={HelpIcon}
          label="Help"
          children={null}
          onClose={() => {}}
          closeLink=""
          Widgets={null}
        />
        <Layout.Content
          style={{ padding: 20, backgroundColor: "var(--light-bg)" }}
        >
          <RenderEach
            renderList={HELP_ITEMS}
            renderItem={(item) => {
              return (
                <Box
                  className="flex flex-row justify-between items-center p-3 border-b cursor-pointer hover:bg-slate-100 hover:text-text-title transition-all duration-100"
                  onClick={() => setGetItemIndex(item?.id)}
                >
                  {item?.name}
                </Box>
              );
            }}
          />
        </Layout.Content>
      </Layout.Page>
    </Collapse>
  );
};

const Help = () => {
  return (
    <HelpProvider>
      <HelpContent />
    </HelpProvider>
  );
};

export default Help;
