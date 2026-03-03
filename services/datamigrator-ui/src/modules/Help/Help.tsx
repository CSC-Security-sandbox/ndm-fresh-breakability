import { useContext } from "react";
import { Collapse } from "@mui/material";
import { Layout, WizardHeader } from "@netapp/bxp-design-system-react";
import { HelpIcon } from "@netapp/bxp-style/react-icons/General";
import Box from "@/components/container/Box";
import RenderEach from "@components/render-each/RenderEach.tsx";
import { HelpProvider, HelpContext } from "@modules/Help/context/HelpContext";
import { HELP_ITEMS, HELP_ITEMS_ENUM } from "@modules/Help/constants/help.constants";
import { useHelpContent } from "@modules/Help/hook/useHelpContent";
import { useDrawerNavigation } from "@hooks/useDrawerNavigation";
import AsupHelpItem from "@modules/Help/components/asup-metrics/components/AsupHelpItem";

const HelpContent = () => {
  const { isHelpListVisible, setGetItemIndex } = useContext(HelpContext);
  const { handleCloseDrawer } = useDrawerNavigation("HelpContent");

  useHelpContent();

  return (
    <Collapse in={isHelpListVisible} mountOnEnter unmountOnExit>
      <Layout.Page>
        <WizardHeader
          logo={null}
          Icon={HelpIcon}
          label="Help"
          children={null}
          onClose={handleCloseDrawer}
          closeLink=""
          Widgets={null}
        />
        <Layout.Content
          style={{ padding: 20, backgroundColor: "var(--light-bg)" }}
        >
          <RenderEach
            renderList={HELP_ITEMS}
            renderItem={(item) => {
              // Special rendering for ASUP Metrics Sharing with toggle (not clickable)
              if (item.name === HELP_ITEMS_ENUM.ASUP_METRICS_SHARING) {
                return <AsupHelpItem key={item.id} />;
              }
              
              // Default rendering for other items
              return (
                <Box
                  key={item.id}
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
