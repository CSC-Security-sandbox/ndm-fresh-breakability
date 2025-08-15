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
  PROJECT_AND_WORKER_LABEL,
} from "@modules/Help/components/support-bundle/constants/support-bundle.constant";
import { SupportBundleFormErrorsType } from "@modules/Help/components/support-bundle/types/support-bundle.types";
import "./SupportBundleForm.css";

const SupportBundleForm = () => {
  const {
    supportBundleForm,
    handleDateChange,
    treeSelectStyles,
    handleSelectionChange,
    wrapperClass,
    projectWorkerData,
  } = useContext(SupportBundleContext);

  const { startDate, endDate } = supportBundleForm?.formState;
  const formErrors =
    supportBundleForm?.formErrors as SupportBundleFormErrorsType;
  const datePickerError = formErrors?.startDate || formErrors?.endDate || "";

  return (
    <Box className="flex flex-col gap-2 p-4">
      <Box className="flex gap-4 items-center">
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

      <Box className="flex flex-row gap-4 items-center">
        <Box className="flex flex-col relative w-full mb-4">
          <label className="text-sm mb-1 inline-block">
            {PROJECT_AND_WORKER_LABEL}
          </label>
          <Box>
            <style>{treeSelectStyles}</style>
            <Box className={wrapperClass}>
              <TreeSelect
                name="projectWorker"
                form={supportBundleForm}
                treeData={projectWorkerData?.data?.items || []}
                isSearchable
                menuType="multi"
                uniqueIdentifier="id"
                onChange={handleSelectionChange}
              />
            </Box>
          </Box>
        </Box>

        <FormFieldSelect
          label="Other Metrics"
          name="otherMetrics"
          form={supportBundleForm}
          options={METRICS_OPTIONS}
          isOptional
          isSearchable
          isMulti
          hasSelectAll
        />
      </Box>
    </Box>
  );
};

export default SupportBundleForm;
