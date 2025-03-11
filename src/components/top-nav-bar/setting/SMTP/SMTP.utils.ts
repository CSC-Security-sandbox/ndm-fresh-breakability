interface ToEmail {
  label: string;
  value: string;
}

interface SmtpProps {
  ip_address: string;
  port: number;
  user_name: string;
  password: string;
  from_email: string;
  to_email: ToEmail[];
}

export const smtpData = (smtpProps: SmtpProps) => {
  const toEmailIds = smtpProps.to_email.map((obj : any) => obj.value).join(',');

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