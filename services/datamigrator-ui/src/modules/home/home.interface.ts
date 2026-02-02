export interface SeverityMessage {
  message: string;
  timestamp: Date;
}

export interface NoticeBoardDetailsType {
  countErroredJobRuns: number;
  countBlockedCutoverJobRuns: number;
  countRecentJobConfigs: number;
  countCompletedJobRuns: number;
  severityMessages: SeverityMessage[] | string[]; // Support both new and legacy formats
}

export interface NotificationsTileType {
  title: string;
  Icon: any;
  content: string | React.ReactElement;
}

export interface NotificationsContentProps {
  setTotalNotifications: (total: number) => void;
}
