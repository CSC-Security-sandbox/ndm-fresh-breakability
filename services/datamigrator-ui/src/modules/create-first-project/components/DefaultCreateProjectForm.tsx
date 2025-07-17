import {Box} from '@components/container/index';
import AppFooter from '@/components/layout/app-footer/AppFooter';
import withCreateProject from '@/hoc/withCreateProject';
import {setProject} from '@store/reducer/appSlice';
import {Button, Card, FormFieldInputNew, FormFieldTextArea, Layout, TabHeader} from '@netapp/bxp-design-system-react';
import {BlueXpFormType, CreateProjectResponseType} from '@/types/app.type';
import {useDispatch} from 'react-redux';

interface DefaultCreateProjectFormType {
  createProjectForm: BlueXpFormType<DefaultCreateProjectFormType>;
  handleCreateProject: () => Promise<CreateProjectResponseType>;
}

const DefaultCreateProjectForm = ({
  createProjectForm,
  handleCreateProject,
}: DefaultCreateProjectFormType) => {
  const dispatch = useDispatch();

  const handleProjectCreation = async () => {
    const response: CreateProjectResponseType = await handleCreateProject();
    dispatch(setProject(response?.data?.id || ''));
  };

  const FOOTER_CONTENT = (
    <Button
      onClick={handleProjectCreation}
      disabled={!createProjectForm.isValid}
    >
      Create
    </Button>
  );
  return (
    <Box className="h-screen">
      <TabHeader label="Project Details" />
      <Layout.Content className="p-[40px] h-[80vh]">
        <Card className="p-6 m-6">
          <Box className="w-4/6">
            <FormFieldInputNew
              form={createProjectForm}
              name="project_name"
              placeholder="Project Name"
              label="Project Name"
              onBlur={(e: any) => {
                createProjectForm.resetForm({
                  ...createProjectForm?.formState,
                  project_name: e.target.value.trim(),
                });
              }}
            />
            <FormFieldTextArea
              isOptional
              form={createProjectForm}
              name="project_description"
              placeholder="Project Description"
              label="Project Description"
              charCount={true}
              maxChars={500}
            />
          </Box>
        </Card>
      </Layout.Content>
      <AppFooter footerContent={FOOTER_CONTENT} isCreateFirstProject={true} />
    </Box>
  );
};

export default withCreateProject(DefaultCreateProjectForm);
