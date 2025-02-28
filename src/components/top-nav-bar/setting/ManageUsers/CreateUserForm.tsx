import Box from "@/components/container/Box";
import { notify } from "@components/notification/NotificationWrapper";
import {
  useAssociateUserMutation,
  useCreateUserMutation,
  useGetAllRolesQuery,
} from "@api/userApi";
import { Collapse } from "@mui/material";
import {
  Button,
  Card,
  FormFieldInputNew,
  Heading,
  Layout,
  useForm,
  WizardFooter,
  Checkbox,
} from "@netapp/bxp-design-system-react";
import { useEffect, useState } from "react";
import {
  CREATE_USER_FORM_VALIDATION_SCHEMA,
  RoleApiType,
} from "./ManageUsers.constant";
import React from "react";
import TemporaryPassword from "./TemporaryPassword";
import { USER_ROLES_ENUM } from "@/types/app.type";

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
      setTemporaryPassword(createUserResponse.tempPassword);
      if (form.formState.is_app_admin) {
        await associateUserApi({
          account_id: import.meta.env.VITE_PUBLIC_HARD_CODE_ACCOUNT_ID,
          user_id: createUserResponse.user.id,
          role_id: roles?.find(
            (row) => row.role_name === USER_ROLES_ENUM.APP_ADMIN
          )?.id,
          project_id: "",
        }).unwrap();
      }
      notify.success(`Users added successfully.`);
      setShowTemporaryPassword(true);
    } catch (err) {
      notify.error("Failed to add User.");
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
                />
                <FormFieldInputNew
                  form={form}
                  name="last_name"
                  label="Last Name"
                />
              </Box>
              <FormFieldInputNew form={form} name="email" label="Email" />
              <Checkbox form={form} name="is_app_admin" key="is_app_admin">
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
            >
              Cancel
            </Button>
            <Button
              style={{ width: 150 }}
              onClick={form.handleFormSubmit(handleCreateUser)}
              disabled={!(form.isValid && form.dirty)}
              isSubmitting={isCreateFormSubmitting || isAssociateFormSubmitting}
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
