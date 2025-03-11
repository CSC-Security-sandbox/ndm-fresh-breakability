import { JobTaskErrorsTabsPropsType } from "@modules/jobs/job-task-errors/JobTaskErrorsTabs.interface";
import { InnerTab } from "@netapp/bxp-design-system-react";

const JobTaskErrorsTabs = ({
  currentTab,
  setCurrentTab,
}: JobTaskErrorsTabsPropsType) => {
  return (
    <InnerTab>
      <InnerTab.Button
        isActive={currentTab === 1}
        onClick={() => {
          setCurrentTab(1);
        }}
      >
        Fatal Errors
      </InnerTab.Button>
      <InnerTab.Button
        isActive={currentTab === 2}
        onClick={() => {
          setCurrentTab(2);
        }}
      >
        Transient Errors
      </InnerTab.Button>
    </InnerTab>
  );
};

export default JobTaskErrorsTabs;
