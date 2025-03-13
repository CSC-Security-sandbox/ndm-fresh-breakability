import {
  SmtpDataPropsType,
  ToEmailType
} from "@/types/app.type";

export const smtpData = (smtpProps: SmtpDataPropsType) => {
  const toEmailIds = smtpProps.to_email.map((obj : ToEmailType) => obj.value).join(',');

  const payLoad = [
    { settingKey: "SMTP_HOST", settingValue: smtpProps.ip_address, description: "", settingType: "SMTP" },
    { settingKey: "SMTP_PORT", settingValue: smtpProps.port, description: "", settingType: "SMTP" },
    { settingKey: "SMTP_USER_NAME", settingValue: smtpProps.user_name, description: "", settingType: "SMTP" },
    { settingKey: "SMTP_PASSWORD", settingValue: smtpProps.password, description: "", settingType: "SMTP" },
    { settingKey: "SMTP_FROM_EMAIL", settingValue: smtpProps.from_email, description: "", settingType: "SMTP" },
    { settingKey: "SMTP_TO_EMAIL", settingValue: toEmailIds, description: "", settingType: "SMTP"}
  ];

  return {
    payLoad,
  };
}