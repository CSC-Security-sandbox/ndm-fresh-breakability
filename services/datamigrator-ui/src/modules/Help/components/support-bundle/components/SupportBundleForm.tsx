import { DatePicker, FormFieldSelect } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container";
import { useContext } from "react";
import { SupportBundleContext } from "@modules/Help/components/support-bundle/context/context";
import { METRICS_OPTIONS } from "@modules/Help/components/support-bundle/constants/support-bundle.constant";
import { SupportBundleFormErrorsType } from "@modules/Help/components/support-bundle/types/support-bundle.types";

const SupportBundleForm = () => {
  const { supportBundleForm, handleDateChange } =
    useContext(SupportBundleContext);

  const { startDate, endDate } = supportBundleForm?.formState;
  const formErrors =
    supportBundleForm?.formErrors as SupportBundleFormErrorsType;
  const datePickerError = formErrors?.startDate || formErrors?.endDate || "";

  return (
    <Box className="flex flex-row gap-4 p-6 items-center">
      <Box className="mb-5">
        <DatePicker
          label="Date Range"
          dateMode="range"
          selectedInitialDate={startDate}
          selectedEndDate={endDate}
          onSave={handleDateChange}
          error={
            datePickerError
              ? { severity: "error", message: datePickerError }
              : undefined
          }
        />
      </Box>

      <FormFieldSelect
        label="Other Metrics"
        name="otherMetrics"
        form={supportBundleForm}
        options={METRICS_OPTIONS}
        isOptional
      />
    </Box>
  );
};

export default SupportBundleForm;
