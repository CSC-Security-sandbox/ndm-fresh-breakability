import React, { useEffect, useState } from "react";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import {
  Button,
  Card,
  FormFieldInputNew,
  FormFieldSelect,
  Heading,
  Layout,
  useForm,
  WizardFooter,
} from "@netapp/bxp-design-system-react";
import {
  CREATE_SMTP_FORM_VALIDATION_SCHEMA,
  INITIAL_SMTP_FORM_STATE,
} from "@components/top-nav-bar/setting/SMTP/SMTP.constants";
import {
  useCreateSmtpMutation,
  useGetAllUsersQuery,
  useGetSmtpDetailsQuery,
  useUpdateSmtpDataMutation,
} from "@api/userApi";
import { useDispatch } from "react-redux";
import { setDrawerClose } from "@store/reducer/commonComponentSlice";
import ErrorMessageContainer from "@components/container/ErrorMessageContainer";
import { smtpData } from "@components/top-nav-bar/setting/SMTP/SMTP.utils";
import { smtpValuesType } from "@/types/app.type";

interface SmtpDetailsPropsType {
  handleDefaultTab: () => void;
}

const CreateSMTP = ({ handleDefaultTab }: SmtpDetailsPropsType) => {
  const dispatch = useDispatch();
  const [createSmtpApi, { isLoading: isCreateFormSubmitting }] =
    useCreateSmtpMutation();
  const [updateSmtpDataAPi, { isLoading: isUpdateFormSubmitting }] =
    useUpdateSmtpDataMutation();

  const { data: userData } = useGetAllUsersQuery("");
  const toEmailOptions =
  userData?.map((user) => ({
    label: user.email,
    value: user.email,
  })) || [];

  const { data: smtpExistingData, isLoading: smtpLoading } =
    useGetSmtpDetailsQuery("");
  const [isEdit, setIsEdit] = useState<boolean>(false);
  const objectData: smtpValuesType = {
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_USER_NAME: "",
    SMTP_PASSWORD: "",
    SMTP_FROM_EMAIL: "",
    SMTP_TO_EMAIL: "",
  };

  const getSmtpData = (values) => {
    values.forEach((item) => {
      objectData[item.settingKey] = item.settingValue;
    });
    return objectData;
  };

  const smtpValues = isEdit
    ? getSmtpData(smtpExistingData?.data?.SMTP)
    : objectData;

  const getStructuredToEmails = (emailsString) => {
    return emailsString
      .split(",")
      .map((eachEmail) => ({ label: eachEmail, value: eachEmail }));
  };

  const getFormData = (data) => {
    return {
      ip_address: data?.SMTP_HOST,
      port: Number(data?.SMTP_PORT),
      user_name: data?.SMTP_USER_NAME,
      password: data?.SMTP_PASSWORD,
      from_email: data?.SMTP_FROM_EMAIL,
      to_email: getStructuredToEmails(data?.SMTP_TO_EMAIL),
    };
  };

  const FORM_DATA = isEdit ? getFormData(smtpValues) : INITIAL_SMTP_FORM_STATE;
  const smtpForm = useForm(FORM_DATA, CREATE_SMTP_FORM_VALIDATION_SCHEMA);

  useEffect(() => {
    if (!smtpLoading && smtpExistingData?.data?.SMTP?.length > 0) {
      setIsEdit(true);
      smtpForm.resetForm(getFormData(smtpValues));
    }
  }, [smtpLoading, smtpExistingData, isEdit]);

  const handleCreateSMTP = async () => {
    const data = smtpData(smtpForm.formState);

    try {
      if (isEdit) {
        const result = await updateSmtpDataAPi(data.payLoad).unwrap();
        notify.success(result.message);
      } else {
        const result = await createSmtpApi(data.payLoad).unwrap();
        notify.success(result.message);
      }
      dispatch(setDrawerClose());
      handleDefaultTab();
    } catch (err) {
      notify.error(
        <ErrorMessageContainer
          title="Error occurred."
          message={err?.error || err?.message || "Failed to create or update SMTP settings."}
        />
      );
    }
  };

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
                onBlur={(e: any) => {
                  smtpForm.resetForm({
                    ...smtpForm?.formState,
                    ip_address: e.target.value.trim(),
                  });
                }}
              />
              <FormFieldInputNew
                form={smtpForm}
                name="port"
                label="Port"
                onBlur={(e: any) => {
                  smtpForm.resetForm({
                    ...smtpForm?.formState,
                    port: e.target.value.trim(),
                  });
                }}
              />
            </Box>
            <Box className="flex gap-4">
              <FormFieldInputNew
                form={smtpForm}
                name="user_name"
                label="Username"
                onBlur={(e: any) => {
                  smtpForm.resetForm({
                    ...smtpForm?.formState,
                    user_name: e.target.value.trim(),
                  });
                }}
              />
              <FormFieldInputNew
                form={smtpForm}
                name="password"
                type="password"
                label="Password"
                onBlur={(e: any) => {
                  smtpForm.resetForm({
                    ...smtpForm?.formState,
                    password: e.target.value.trim(),
                  });
                }}
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
              style={{ paddingBottom: "6rem" }}
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
            isSubmitting={
              isCreateFormSubmitting || isUpdateFormSubmitting || smtpLoading
            }
          >
            Save
          </Button>
        </Box>
      </WizardFooter>
    </Layout.Page>
  );
};

export default React.memo(CreateSMTP);
