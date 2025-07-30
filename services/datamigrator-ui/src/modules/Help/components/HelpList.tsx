import Box from "@/components/container/Box";
import { Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import { HELP_ITEMS } from "@modules/Help/constants/help.constants";
import { useContext } from "react";
import { Collapse } from "@mui/material";
import RenderEach from "@components/render-each/RenderEach.tsx";
import { HelpContext } from "@modules/Help/context/HelpContext";
import { useHelpContent } from "@modules/Help/hook/useHelpContent";

const HelpList = () => {
  const { isHelpListVisible, setGetItemIndex } = useContext(HelpContext);

  useHelpContent();

  return (
    <Collapse in={isHelpListVisible} mountOnEnter unmountOnExit>
      <Layout.Page>
        <WizardHeader Icon={HelpIcon} label="Help" />
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

export default HelpList;
