import React, { useState, useEffect } from "react";
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
  INITIAL_SMTP_FORM_STATE
} from "./SMTP.constants";
import {
  useGetAllUsersQuery,
} from "@api/userApi";
import {
  useCreateSmtpMutation,
  useUpdateSmtpDataMutation,
  useGetSmtpDetailsQuery,
} from "@api/userApi";
import { useDispatch } from "react-redux";
import { setDrawerClose } from "@store/reducer/commonComponentSlice";
import ErrorMessageContainer from "@components/container/ErrorMessageContainer";
import { smtpData } from './SMTP.utils';
import {
  smtpValuesType,
} from "@/types/app.type";

interface SmtpDetailsPropsType {
  handleDefaultTab: () => void;
}

const CreateSMTP = ({handleDefaultTab}: SmtpDetailsPropsType) => {
  const dispatch = useDispatch();
  const [createSmtpApi, { isLoading: isCreateFormSubmitting }] = useCreateSmtpMutation();
  const [updateSmtpDataAPi, { isLoading: isUpdateFormSubmitting }] = useUpdateSmtpDataMutation();

  //gettig to email ids
  const { data: userData, isLoading: usersLoading} = useGetAllUsersQuery("");
  const toEmailOptions = userData.length > 0 ? (
    userData.map((user) => {
      return {label: user.email, value: user.email}
    })
  ) : [];

  //getting smtp data
  const { data: smtpExistingData, isLoading: smtpLoading } = useGetSmtpDetailsQuery("");

  console.log({smtpExistingData, smtpLoading})
  const [isEdit, setIsEdit] = useState<boolean>((smtpExistingData?.data?.SMTP?.length > 0 && !smtpLoading) ? true : false);

  // const isEdit = smtpExistingData?.data?.SMTP?.length > 0 ? true : false;
  const objectData : smtpValuesType = {
                                      SMTP_HOST: "",
                                      SMTP_PORT: "",
                                      SMTP_USER_NAME: "",
                                      SMTP_PASSWORD: "",
                                      SMTP_FROM_EMAIL: "",
                                      SMTP_TO_EMAIL: "",
                                    };

  const getSmtpData = (values) => {
    console.log({values, isEdit})
    values.forEach(item => {
      objectData[item.settingKey] = item.settingValue;
    });
    return objectData;
  }
  // const [smtpValues, setSmtpValues] = useState<smtpValuesType>(isEdit ? getSmtpData(smtpExistingData?.data?.SMTP) : objectData);
  const smtpValues = isEdit ? getSmtpData(smtpExistingData?.data?.SMTP) : objectData;

  //setting structured to emails
  const getStructuredToEmails = (eamilsString) => {
    console.log({eamilsString})
    const toEmailIds = eamilsString.split(",").map((eachEmail) => {
      return {label: eachEmail, value: eachEmail}
    })
    return toEmailIds;
  }

  //setting form data
  const getFormData = (data) => {
    console.log({smtpValues, data})
    const prefillingData = {
      ip_address: data?.SMTP_HOST,
      port: Number(data?.SMTP_PORT),
      user_name: data?.SMTP_USER_NAME,
      password: data?.SMTP_PASSWORD,
      from_email: data?.SMTP_FROM_EMAIL,
      to_email: getStructuredToEmails(data?.SMTP_TO_EMAIL),
    };
    return prefillingData;
  };

  const FORM_DATA = isEdit ? getFormData(smtpValues) : INITIAL_SMTP_FORM_STATE;
  console.log("form data");
  const smtpForm = useForm(
    FORM_DATA,
    CREATE_SMTP_FORM_VALIDATION_SCHEMA
  );

  if (isEdit) {
    console.log("is edit", smtpValues, FORM_DATA)
    // smtpForm.resetForm({
    //   FORM_DATA,
    //   CREATE_SMTP_FORM_VALIDATION_SCHEMA
    // })
  }

  // Update form values when smtpExistingData changes
  useEffect(() => {
    console.log("did update", isEdit, smtpLoading);
    if (!smtpLoading) {
      // setSmtpValues(getSmtpData(smtpExistingData?.data?.SMTP));
      setIsEdit(smtpExistingData?.data?.SMTP.length > 0 ? true :false);
      
      console.log("inside if", smtpValues)
      console.log(smtpExistingData?.data?.SMTP)
      // const FORM_DATA = getFormData(getSmtpData(smtpExistingData?.data?.SMTP));
      // smtpForm.resetForm({
      //   FORM_DATA,
      //   CREATE_SMTP_FORM_VALIDATION_SCHEMA
      // })
    }
  }, [smtpLoading]);

  const handleCreateSMTP = async () => {
    const data = smtpData(smtpForm.formState);

    if (isEdit) {
      try {
        await updateSmtpDataAPi(data.payLoad).unwrap();
        dispatch(setDrawerClose());
        handleDefaultTab();
        notify.success(`SMTP details updated successfully.`);
      } catch (err) {
        notify.error(
          <ErrorMessageContainer
            title="Error occurred."
            message={err?.message || "Failed to updated SMTP Details"}
          />
        );
      }
    } else {
      try {
        await createSmtpApi(data.payLoad).unwrap();
        dispatch(setDrawerClose());
        handleDefaultTab();
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
  }

  return (
    // (!smtpLoading &&
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
              isSubmitting={isCreateFormSubmitting || isUpdateFormSubmitting || !smtpLoading}
            >
              Save
            </Button>
          </Box>
        </WizardFooter>
      </Layout.Page>
    // )
  );
};

export default React.memo(CreateSMTP);
