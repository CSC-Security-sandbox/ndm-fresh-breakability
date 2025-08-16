export enum INCREMENTAL_SYNC_SCHEDULE_ENUM {
  OFF = "Off",
  SCHEDULE = "schedule",
  CRON_EXPRESSION = "cron_expression",
}

export const INCREMENTAL_SYNC_SCHEDULE_OPTIONS = [
  { label: "Off", value: INCREMENTAL_SYNC_SCHEDULE_ENUM.OFF },
  { label: "Schedule", value: INCREMENTAL_SYNC_SCHEDULE_ENUM.SCHEDULE },
  {
    label: "Cron Expression",
    value: INCREMENTAL_SYNC_SCHEDULE_ENUM.CRON_EXPRESSION,
  },
];
