import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";
import { Box } from "@components/container/index";
import {
  FormFieldInputNew,
  FormFieldSelect,
  InlineNotification,
  Card,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";

const JobConfig = () => {
  const { jobConfigForm, mountPaths, isEditMode } = useContext(
    CommonFileServerContext
  );

  return (
    <FormFrame>
      <Card className="p-6 flex flex-col gap-4">
        <InlineNotification type="info" prefix="Information">
          This section is optional. However, without it,
          <strong>speed tests will not be possible</strong>.
        </InlineNotification>
        {isEditMode ? (
          // SELECT BOX IF WE ARE EDITING AND WE HAVE MOUNT PATHS
          <FormFieldSelect
            label="Export Paths"
            name="pathId"
            form={jobConfigForm}
            options={mountPaths}
            isOptional
          />
        ) : (
          // SELECT BOX IF WE ARE CREATING AND WE DON"T HAVE MOUNT PATHS
          <FormFieldInputNew
            label="Export Path"
            name="pathName"
            form={jobConfigForm}
            placeholder="Enter Export Path"
            isOptional
          />
        )}
        <FormFieldInputNew
          form={jobConfigForm}
          disabled={
            isEditMode
              ? jobConfigForm?.formState?.pathId?.value?.length === 0
              : jobConfigForm?.formState?.pathName?.length === 0
          }
          name="workingDirectory"
          placeholder="Working Directory"
          label="Working Directory"
        />
      </Card>
    </FormFrame>
  );
};

export default JobConfig;
