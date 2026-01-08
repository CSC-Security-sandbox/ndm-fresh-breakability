import dayjs from "dayjs";

export const parseIncrementalSchedule = (schedule: string) => {
    if (!schedule || schedule === "Off") {
      return {
        schedule: "Off",
        set: "hourly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }
    if (schedule.includes("*") || /^\d+\s+\d+\s+\d+\s+\d+\s+\d+$/.test(schedule.trim()) || /^[\d\*\-\,\/\s]+$/.test(schedule.trim())) {
      return {
        schedule: "cron_expression",
        set: "hourly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: schedule
      };
    }
    if (schedule.includes('T') || schedule.includes('-') || schedule.includes('/') || schedule.includes(':')) {
      const scheduleDate = dayjs(schedule);
      if (scheduleDate.isValid()) {
        return {
          schedule: "schedule",
          set: "daily",
          daily: scheduleDate,
          weekly: "day",
          weeklyDay: { label: scheduleDate.date().toString(), value: scheduleDate.date() },
          weeklyWeekday: { label: scheduleDate.format('dddd'), value: scheduleDate.day() },
          cronExpression: "* * * * *"
        };
      }
    }
    const lowerSchedule = schedule.toLowerCase();
    if (lowerSchedule.includes('hour')) {
      return {
        schedule: "schedule",
        set: "hourly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }
    if (lowerSchedule.includes('day') || lowerSchedule.includes('daily')) {
      return {
        schedule: "schedule",
        set: "daily",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }
    if (lowerSchedule.includes('week')) {
      return {
        schedule: "schedule",
        set: "weekly",
        daily: dayjs().hour(10).minute(30),
        weekly: "day",
        weeklyDay: { label: "1", value: 1 },
        weeklyWeekday: { label: "Sunday", value: 0 },
        cronExpression: "* * * * *"
      };
    }

    return {
      schedule: "schedule",
      set: "hourly",
      daily: dayjs().hour(10).minute(30),
      weekly: "day",
      weeklyDay: { label: "1", value: 1 },
      weeklyWeekday: { label: "Sunday", value: 0 },
      cronExpression: "* * * * *"
    };
}

export const parseSkipFiles = (skipValue: string) => {
    if (skipValue === "-") return { num: 15, option: "M" };
    const match = skipValue.match(/^(\d+)-?(Mins?|Hrs?|Days?)$/);
    if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    let option = "M";
    if (unit.startsWith("Hr")) option = "H";
    else if (unit.startsWith("Day")) option = "D";
    return { num, option };
    }
    return { num: 15, option: "M" };
}
