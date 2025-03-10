import { Box } from "@components/container/index";
import { InnerTab } from "@netapp/bxp-design-system-react";
import { OverviewTabsPropsType } from "../overview.interface";
import { formatLength } from "@/utils/common.utils";

const OverviewTabs = ({
  currentTab,
  setCurrentTab,
  allExportPaths,
  allWorkersList,
}: OverviewTabsPropsType) => {
  return (
    <Box className="flex items-center my-3">
      <InnerTab variant="card">
        <InnerTab.Button
          isActive={currentTab === 1}
          onClick={() => {
            setCurrentTab(1);
          }}
        >
          Path {`(${formatLength(allExportPaths?.length)})`}
        </InnerTab.Button>
        <InnerTab.Button
          isActive={currentTab === 2}
          onClick={() => {
            setCurrentTab(2);
          }}
        >
          Workers {`(${formatLength(allWorkersList?.length)})`}
        </InnerTab.Button>
      </InnerTab>
    </Box>
  );
};

export default OverviewTabs;
