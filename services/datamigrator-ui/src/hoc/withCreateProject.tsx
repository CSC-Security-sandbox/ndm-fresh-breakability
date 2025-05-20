/* eslint-disable */
import { BlueXpFormType } from "@/types/app.type";
import {
  useCreateProjectMutation,
  useUpdateProjectMutation,
} from "@api/projectApi";
import { useForm } from "@netapp/bxp-design-system-react";
import * as Yup from "yup";
import useAccountDetails from "@/hooks/useAccountDetails";

const CREATE_PROJECT_VALIDATION_SCHEMA = Yup.object({
  project_name: Yup.string().required("Project Name is required"),
  project_description: Yup.string(),
});

interface CreateProjectFormType {
  project_name: string;
  project_description: string;
  account_id: string;
  start_date: Date;
}

const initialProjectFormValue: CreateProjectFormType = {
  project_name: "",
  project_description: "",
  account_id: "",
  start_date: new Date(),
};

const withCreateProject = (WrappedComponent: any) => {
  return (props: any) => {
    const { accountDetails } = useAccountDetails();
    const [createProjectApi] = useCreateProjectMutation();
    const [updateProjectApi] = useUpdateProjectMutation();

    const createProjectForm: BlueXpFormType<CreateProjectFormType> = useForm(
      initialProjectFormValue,
      CREATE_PROJECT_VALIDATION_SCHEMA
    );

    const handleCreateProject = async () => {
      return await createProjectApi({
        ...createProjectForm?.formState,
        account_id: accountDetails?.id,
      }).unwrap();
    };

    const handleUpdateProject = async (project_id: string) => {
      return await updateProjectApi({
        project_id,
        body: {
          project_description:
            createProjectForm?.formState?.project_description,
        },
      }).unwrap();
    };

    const resetForm = () => {
      createProjectForm.resetForm(initialProjectFormValue);
      createProjectForm.resetSubmissionAttempted();
    };

    return (
      <WrappedComponent
        {...props}
        resetForm={resetForm}
        createProjectForm={createProjectForm}
        handleUpdateProject={handleUpdateProject}
        handleCreateProject={handleCreateProject}
      />
    );
  };
};

export default withCreateProject;
