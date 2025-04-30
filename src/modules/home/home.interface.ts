export interface NoticeBoardDetailsType {
  countErroredJobRuns: number;
  countBlockedCutoverJobRuns: number;
  countRecentJobConfigs: number;
  countCompletedJobRuns: number;
  severityMessages: string[];
}

export interface NotificationsTileType {
  title: string;
  Icon: any;
  content: string | React.ReactElement;
}

export interface NotificationsContentProps {
  setTotalNotifications: (total: number) => void;
}
