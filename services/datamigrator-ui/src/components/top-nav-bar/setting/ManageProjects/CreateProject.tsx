/* eslint-disable */
import React, {useEffect, useState} from 'react';
import {
  Button,
  Card,
  FormFieldInputNew,
  FormFieldTextArea,
  Heading,
  Layout,
  Text,
  Tooltip,
  useForm,
  WizardFooter
} from '@netapp/bxp-design-system-react';
import Box from '@/components/container/Box';
import AssociateUsers from '@components/top-nav-bar/setting/ManageProjects/components/AssociateUsers';
import {
  ASSOCIATE_USER_FORM_VALIDATION_SCHEMA
} from '@components/top-nav-bar/setting/ManageProjects/ManageProjects.constant';
import {
  useAssociateUserBatchMutation,
  useGetAllRolesQuery,
  useGetAllUsersQuery,
  useLazyGetAllUserRolesQuery
} from '@api/userApi';
import {
  AssociatedUsersOptionsType,
  BlueXpFormType,
  CreateProjectPropsType,
  USER_ROLES_ENUM,
  USER_STATUS_ENUM,
  UserApiType
} from '@/types/app.type';
import withCreateProject from '@/hoc/withCreateProject';
import ErrorMessageContainer from '@components/container/ErrorMessageContainer';
import {notify} from '@components/notification/NotificationWrapper';
import {Show} from '@components/show/Show';

const CreateProjectForm = ({
  closeAction,
  submitAction,
  createProjectForm,
  handleCreateProject,
  editSelectedProject,
  resetForm: resetProjectForm,
  handleUpdateProject,
}: CreateProjectPropsType) => {
  const {data: getAllUserResult, isLoading: usersLoading} =
      useGetAllUsersQuery('');
  const {data: getAllRoleSResult, isLoading: rolesLoading} =
      useGetAllRolesQuery('');
  const users = getAllUserResult || [];
  const roles = getAllRoleSResult || [];
  const editMode = !!editSelectedProject?.id;
  const [getAllAssociatedUser] = useLazyGetAllUserRolesQuery();
  const [associatedUsers, setAssociatedUsers] = useState<
    AssociatedUsersOptionsType[]
  >([]);
  const [failedToFetchAssociateUsers, setFailedToFetchAssociateUsers] =
    useState<boolean>(false);

  useEffect(() => {
    createProjectForm.resetForm({
      ...createProjectForm?.formState,
      project_name: editSelectedProject?.project_name || "",
      project_description: editSelectedProject?.project_description || "",
    });
    if (editMode) {
      (async () => {
        try {
          const res = await getAllAssociatedUser({
            project_id: editSelectedProject?.id,
          }).unwrap();
          const tempAssociatedUsers: AssociatedUsersOptionsType[] =
            res?.map((userRoles: any) => ({
              user: {
                label: userRoles?.user?.email,
                value: userRoles?.user?.id,
              },
              role: {
                label: userRoles?.role?.role_name,
                value: userRoles?.role?.id,
              },
            }));
          setAssociatedUsers(tempAssociatedUsers);
        } catch (error) {
          const errorData = error?.data || {};
          setFailedToFetchAssociateUsers(true);
          notify.error(errorData.message);
          console.error({ error, level: "Get Associate user list" });
        }
      })();
    }
  }, [editSelectedProject]);

  const associateUserForm: BlueXpFormType<AssociatedUsersOptionsType> = useForm(
    { user: undefined, role: undefined },
    ASSOCIATE_USER_FORM_VALIDATION_SCHEMA
  );

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [associatedUserWithProjectBatch] = useAssociateUserBatchMutation();
  const handleAssociateUsers = async (projectId: string) => {
    const body = {
      project_id: projectId,
      account_id: localStorage.getItem("account_id"),
      users: associatedUsers?.map(({ user, role }) => ({
        user_id: user.value,
        role_id: role.value,
      })),
    };
    let response = await associatedUserWithProjectBatch(body).unwrap();
    return response;
  };

  const handleSubmitCreateProject = async () => {
    setIsLoading(true);
    let message: string = '';
    try {
      const handleCreateProjectResult = await handleCreateProject();
      const response = handleCreateProjectResult.data;

      try {
        const handleAssociateUsersResult = await handleAssociateUsers(response.id);
        message = handleCreateProjectResult.message + ' and ' + handleAssociateUsersResult['message'];
        resetProjectForm();
        notify.success(message);
      } catch (err) {
        // improvement needs to be done here to handle the error better
        notify.warning(
            `Project - "${createProjectForm.formState.project_name}" successfully created. But failed to associate the users.`
        );
        console.error({ err, level: "Associate User" });
      }
      handleClose();
      submitAction && submitAction();
    } catch (err: any) {
      notify.error(
        <ErrorMessageContainer
          title="Failed to create Project."
          message={err.data.message}
        />
      );
      console.error({ err, level: "Create Project" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitUpdateProject = async () => {
    setIsLoading(true);
    let message: string = '';
    try {
      let result = await handleUpdateProject(editSelectedProject?.id);
      try {
        let associateUserResult = await handleAssociateUsers(
            editSelectedProject?.id
        );
        message = result.message + ' and ' + associateUserResult['message'];
        resetProjectForm();
        notify.success(message);
        handleClose();
        submitAction && submitAction();
      } catch (err) {
        notify.warning(
            `Project - "${createProjectForm.formState.project_name}" successfully updated. But failed to update the list of associated users.`
        );
        console.error({ err, level: "Associate User" });
      }
    } catch (err: any) {
      notify.error(
        <ErrorMessageContainer
          title="Error occurred."
          message={err?.message}
        />,
      );
      console.error({ err, level: "Update Project" });
    }
    setIsLoading(false);
  };

  const submitUserAction = () => {
    setAssociatedUsers((currentUsers) => [
      ...currentUsers,
      {
        user: associateUserForm.formState.user,
        role: associateUserForm.formState.role,
      },
    ]);
    associateUserForm.resetForm({ user: "", role: "" });
  };

  const removeUserAction = (user: AssociatedUsersOptionsType["user"]) => {
    setAssociatedUsers((currentUsers) =>
      currentUsers?.filter((row) => row.user.value !== user.value)
    );
  };

  const handleClose = () => {
    resetProjectForm();
    associateUserForm.resetForm({ user: "", role: "" });
    setAssociatedUsers([]);
    closeAction();
  };
  return (
    <Layout.Page>
      <Layout.Content>
        <Card className="p-6 flex flex-col gap-6 w-full">
          <Heading level="20">{editMode ? "Edit" : "Add"} Project</Heading>
          <Box className="flex pt-4 flex-row gap-4 justify-end w-full">
            <FormFieldInputNew
              form={createProjectForm}
              label="Project Name"
              placeholder="Project Name"
              name="project_name"
              onChange={(e: any) => {
                createProjectForm.resetForm({
                  ...createProjectForm?.formState,
                  project_name: e.target.value.trimStart(),
                });
              }}
              onBlur={(e: any) => {
                createProjectForm.resetForm({
                  ...createProjectForm?.formState,
                  project_name: e.target.value.trim(),
                });
              }}
              disabled={editMode}
            />
            <FormFieldTextArea
              form={createProjectForm}
              label="Project Description"
              placeholder="Project Description"
              name="project_description"
              isOptional={true}
              charCount={true}
              maxChars={500}
            />
          </Box>
          {!usersLoading && !rolesLoading && (
            <AssociateUsers
              associateUserForm={associateUserForm}
              associatedUsers={associatedUsers}
              userOptions={users
                ?.filter(
                  (user: UserApiType) =>
                    user.user_status === USER_STATUS_ENUM.ACTIVE &&
                    !user.isAppAdmin
                )
                .map((user: UserApiType) => ({
                  label: user.email,
                  value: user.id,
                }))}
              roleOptions={roles
                ?.filter(
                  (roleObject: any) =>
                    roleObject?.role_name !== USER_ROLES_ENUM.APP_ADMIN
                )
                ?.map((role: any) => ({
                  label: role.role_name,
                  value: role.id,
                }))}
              submitUserAction={submitUserAction}
              removeUserAction={removeUserAction}
            />
          )}
        </Card>
      </Layout.Content>
      <WizardFooter className="" style={{}}>
        <Box className="flex w-full justify-end gap-4 mr-4">
          <Button
            style={{ width: 150 }}
            color="secondary"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            style={{ width: 150 }}
            onClick={createProjectForm.handleFormSubmit(
              editMode ? handleSubmitUpdateProject : handleSubmitCreateProject
            )}
            disabled={
              !(createProjectForm.isValid && createProjectForm.dirty) ||
              failedToFetchAssociateUsers
            }
            isSubmitting={isLoading}
          >
            Submit
            <Show.When isTrue={failedToFetchAssociateUsers}>
              <Tooltip>
                <Text>
                  Please note: There was an issue while fetching the list of
                  associated users for this project. As a result, you won't be
                  able to update the project at this time.
                </Text>
              </Tooltip>
            </Show.When>
          </Button>
        </Box>
      </WizardFooter>
    </Layout.Page>
  );
};

export default React.memo(withCreateProject(CreateProjectForm));
