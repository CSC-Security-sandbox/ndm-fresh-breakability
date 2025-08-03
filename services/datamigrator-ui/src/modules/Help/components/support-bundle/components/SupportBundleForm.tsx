import { DatePicker, FormFieldSelect } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { useContext } from "react";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import { METRICS_OPTIONS } from "@modules/Help/components/support-bundle/constants/support-bundle.constant";

const SupportBundleForm = () => {
  const { supportBundleForm, handleDateChange } =
    useContext(SupportBundleContext);

  const { startDate, endDate } = supportBundleForm?.formState;

  return (
    <Box className="flex flex-row gap-4 p-6 items-center">
      <Box className="mb-5">
        <DatePicker
          label="Select Date Range"
          dateMode="range"
          selectedInitialDate={startDate}
          selectedEndDate={endDate}
          onSave={handleDateChange}
        />
      </Box>

      <FormFieldSelect
        label="Select Other Metrics"
        name="other_metrics"
        form={supportBundleForm}
        options={METRICS_OPTIONS}
      />
    </Box>
  );
};

export default SupportBundleForm;
