import {
  DatePicker,
  FormFieldSelect,
  TreeSelect,
} from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { useContext } from "react";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import {
  METRICS_OPTIONS,
  SELECT_PROJECT_AND_WORKER_LABEL,
} from "@modules/Help/components/support-bundle/constants/support-bundle.constant";

const SupportBundleForm = () => {
  const {
    form,
    projectWorkerData,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
    handleDateChange,
  } = useContext(SupportBundleContext);

  const { start_date, end_date } = form?.formState;

  return (
    <Box className="flex flex-col gap-8 p-4">
      <DatePicker
        label="Select Date Range"
        form={form}
        dateMode="range"
        selectedInitialDate={start_date}
        selectedEndDate={end_date}
        onSave={handleDateChange}
      />

      <Box className="flex flex-row gap-4 items-center">
        <Box className="flex flex-col relative w-full mb-5">
          <label className="text-sm mb-1 inline-block">
            {SELECT_PROJECT_AND_WORKER_LABEL}
          </label>
          <Box>
            <style>{treeSelectStyles}</style>
            <Box className={wrapperClass}>
              <TreeSelect
                label="Select Project"
                name="project_worker"
                form={form}
                treeData={projectWorkerData || []}
                isSearchable
                menuType="multi"
                uniqueIdentifier="id"
                onChange={handleSelectionChange}
              />
            </Box>
          </Box>
        </Box>

        <FormFieldSelect
          label="Select Other Metrics"
          name="other_metrics"
          form={form}
          options={METRICS_OPTIONS}
        />
      </Box>
    </Box>
  );
};

export default SupportBundleForm;
