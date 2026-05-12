import Box from '@/components/container/Box';
import {notify} from '@components/notification/NotificationWrapper';
import {useAssociateUserMutation, useCreateUserMutation, useGetAllRolesQuery} from '@api/userApi';
import {Collapse} from '@mui/material';
import {
  Button,
  Card,
  Checkbox,
  FormFieldInputNew,
  Heading,
  Layout,
  useForm,
  WizardFooter
} from '@netapp/bxp-design-system-react';
import React, {useEffect, useState} from 'react';
import {
  CREATE_USER_FORM_VALIDATION_SCHEMA,
  RoleApiType
} from '@components/top-nav-bar/setting/ManageUsers/ManageUsers.constant';
import TemporaryPassword from '@components/top-nav-bar/setting/ManageUsers/TemporaryPassword';
import {USER_ROLES_ENUM} from '@/types/app.type';
import {decryptData} from '@/utils/common.utils';

type CreateUserFormProps = {
  temporaryPassword: string;
  closeAction: () => void;
};

const initialUserFormState = {
  email: "",
  first_name: "",
  last_name: "",
  is_app_admin: false,
};

const CreateUserForm = ({
  closeAction,
  temporaryPassword: temporaryPasswordPre,
}: CreateUserFormProps) => {
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [createUserApi, { isLoading: isCreateFormSubmitting }] =
    useCreateUserMutation();
  const [associateUserApi, { isLoading: isAssociateFormSubmitting }] =
    useAssociateUserMutation();
  const { data: roles } = useGetAllRolesQuery<{ data: RoleApiType }>("");

  const form = useForm(
    initialUserFormState,
    CREATE_USER_FORM_VALIDATION_SCHEMA
  );

  const clearUserForm = () => {
    form.resetForm(initialUserFormState);
    form.resetSubmissionAttempted();
  };

  const handleCreateUser = async () => {
    const body = {
      username: form.formState.email,
      firstName: form.formState.first_name,
      lastName: form.formState.last_name,
    };

    try {
      const createUserResponse = await createUserApi(body).unwrap();
      const decryptedPassword = decryptData(createUserResponse?.data?.tempPassword);
      setTemporaryPassword(decryptedPassword);
      if (form.formState.is_app_admin) {
        await associateUserApi({
          account_id: localStorage.getItem("account_id"),
          user_id: createUserResponse?.data?.user.id,
          role_id: roles?.find(
              (row) => row.role_name === USER_ROLES_ENUM.APP_ADMIN
          )?.id,
          project_id: "",
        }).unwrap();
      }
      notify.success(createUserResponse.message);
      setShowTemporaryPassword(true);
    } catch (err) {
      notify.error(err?.message || "Failed to create user");
      console.error({ err, level: "Add user" });
    }
  };

  const handleClose = () => {
    clearUserForm();
    setShowTemporaryPassword(false);
    setTemporaryPassword("");
    closeAction();
  };

  useEffect(() => {
    if (temporaryPasswordPre) {
      setShowTemporaryPassword(true);
      setTemporaryPassword(temporaryPasswordPre);
    } else {
      setShowTemporaryPassword(false);
      setTemporaryPassword("");
    }
  }, [temporaryPasswordPre]);

  return (
    <Layout.Page>
      <Collapse in={!showTemporaryPassword}>
        <Layout.Content>
          <Card className="p-6 flex flex-col gap-6 w-[50rem]">
            <Heading level="20">Add User</Heading>
            <Box className="flex flex-col gap-2">
              <Box className="flex gap-4">
                <FormFieldInputNew
                  form={form}
                  name="first_name"
                  label="First Name"
                  data-testid="first-name"
                  onBlur={(e: any) => {
                    form.resetForm({
                      ...form?.formState,
                      first_name: e.target.value.trim(),
                    });
                  }}
                />
                <FormFieldInputNew
                  form={form}
                  name="last_name"
                  label="Last Name"
                  data-testid="last-name"
                  onBlur={(e: any) => {
                    form.resetForm({
                      ...form?.formState,
                      last_name: e.target.value.trim(),
                    });
                  }}
                />
              </Box>
              <FormFieldInputNew
                form={form}
                name="email"
                label="Email"
                data-testid="email"
              />
              <Checkbox
                form={form}
                name="is_app_admin"
                key="is_app_admin"
                data-testid="is-app-admin"
              >
                App Admin
              </Checkbox>
            </Box>
          </Card>
        </Layout.Content>
        <WizardFooter className="" style={{}}>
          <Box className="flex w-full justify-end gap-4 mr-4">
            <Button
              style={{ width: 150 }}
              color="secondary"
              onClick={handleClose}
              data-testid="cancel-user"
            >
              Cancel
            </Button>
            <Button
              style={{ width: 150 }}
              onClick={form.handleFormSubmit(handleCreateUser)}
              disabled={!(form.isValid && form.dirty)}
              isSubmitting={isCreateFormSubmitting || isAssociateFormSubmitting}
              data-testid="submit-user"
            >
              Submit
            </Button>
          </Box>
        </WizardFooter>
      </Collapse>
      <Collapse in={showTemporaryPassword}>
        <TemporaryPassword
          isAddUser={temporaryPasswordPre === ""}
          temporaryPassword={temporaryPassword}
          handlePasswordClose={handleClose}
        />
      </Collapse>
    </Layout.Page>
  );
};

export default React.memo(CreateUserForm);
