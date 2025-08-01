import { DatePicker, FormFieldSelect } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { useContext } from "react";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import { METRICS_OPTIONS } from "@modules/Help/components/support-bundle/constants/support-bundle.constant";

const SupportBundleForm = () => {
  const { form, handleDateChange } = useContext(SupportBundleContext);

  const { start_date, end_date } = form?.formState;

  return (
    <Box className="flex flex-row gap-4 p-6 items-center">
      <Box className="mb-5">
        <DatePicker
          label="Select Date Range"
          form={form}
          dateMode="range"
          selectedInitialDate={start_date}
          selectedEndDate={end_date}
          onSave={handleDateChange}
        />
      </Box>

      <FormFieldSelect
        label="Select Other Metrics"
        name="other_metrics"
        form={form}
        options={METRICS_OPTIONS}
      />
    </Box>
  );
};

export default SupportBundleForm;
