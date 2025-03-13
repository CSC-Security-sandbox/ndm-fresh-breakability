export interface NoticeBoardDetailsType {
  countErroredJobRuns: number;
  countBlockedCutoverJobRuns: number;
  countRecentJobConfigs: number;
  countCompletedJobRuns: number;
}

export interface NotificationsTileType {
  title: string;
  Icon: any;
  content: string;
}

export interface NotificationsContentProps {
  setTotalNotifications: (total: number) => void;
}
