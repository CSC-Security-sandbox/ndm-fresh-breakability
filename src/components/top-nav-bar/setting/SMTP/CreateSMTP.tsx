import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import {
  Button,
  Card,
  FormFieldInputNew,
  Heading,
  Layout,
  useForm,
  WizardFooter,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import {
  CREATE_SMTP_FORM_VALIDATION_SCHEMA,
} from "./SMTP.constants";
import React from "react";
import {
  useGetAllUsersQuery,
} from "@api/userApi";
import {
  useCreateSmtpMutation,
} from "@api/userApi";
import { useDispatch } from "react-redux";
import { setDrawerClose } from "@store/reducer/commonComponentSlice";
import { INITIAL_SMTP_FORM_STATE } from "./SMTP.constants";
import ErrorMessageContainer from "@components/container/ErrorMessageContainer";
import { smtpData } from './SMTP.utils';

const CreateSMTP = () => {
  const dispatch = useDispatch();
  const { data: userData } = useGetAllUsersQuery("");
  const toEmailOptions : any = userData.length > 0 ? (
    userData.map((user : any) => {
      return {label: user.email, value: user.email}
    })
  ) : [];
  const [createSmtpApi, { isLoading: isCreateFormSubmitting }] = useCreateSmtpMutation();

  const smtpForm = useForm(
    INITIAL_SMTP_FORM_STATE,
    CREATE_SMTP_FORM_VALIDATION_SCHEMA
  );

  const handleCreateSMTP = async () => {
    const data = smtpData(smtpForm.formState);
    
    try {
      await createSmtpApi(data.payLoad).unwrap();
      dispatch(setDrawerClose());
      notify.success(`SMTP details added successfully.`);
    } catch (err) {
      notify.error(
        <ErrorMessageContainer
          title="Error occurred."
          message={err?.message || "Failed to add SMTP Details"}
        />
      );
    }
  }

  return (
    <Layout.Page className="p-6">
      <Layout.Content>
        <Card className="p-6 flex flex-col gap-6">
          <Heading level="20">SMTP Details</Heading>
          <Box className="flex flex-col gap-2">
            <Box className="flex gap-4">
              <FormFieldInputNew
                form={smtpForm}
                name="ip_address"
                label="IP Address"
              />
              <FormFieldInputNew
                form={smtpForm}
                name="port"
                label="Port"
              />
            </Box>
            <Box className="flex gap-4">
              <FormFieldInputNew
                form={smtpForm}
                name="user_name"
                label="Username"
                />
              <FormFieldInputNew
                form={smtpForm}
                name="password"
                type="password"
                label="Password"
              />
            </Box>
            <FormFieldInputNew
              form={smtpForm}
              type="email"
              name="from_email"
              label="From Email"
            />
            <FormFieldSelect
              label="To Email"
              name="to_email"
              form={smtpForm}
              options={toEmailOptions}
              style={{"paddingBottom": '6rem'}}
              isCreatable={true}
              isMulti={true}
            />
          </Box>
        </Card>
      </Layout.Content>
      <WizardFooter>
        <Box className="flex w-full justify-end gap-4 mr-4">
          <Button
            style={{ width: 150 }}
            onClick={smtpForm.handleFormSubmit(handleCreateSMTP)}
            disabled={!(smtpForm.isValid && smtpForm.dirty)}
            isSubmitting={isCreateFormSubmitting}
          >
            Save
          </Button>
        </Box>
      </WizardFooter>
    </Layout.Page>
  );
};

export default React.memo(CreateSMTP);
