import { useLazyGetNoticeBoardDetailsQuery } from "@api/jobsApi";
import { Box } from "@components/container/index";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  NoticeBoardDetailsType,
  NotificationsContentProps,
} from "@modules/home/home.interface";
import { CardContent, Text } from "@netapp/bxp-design-system-react";
import {
  ErrorIcon,
  InfoIcon,
  LightBulbIcon,
  SuccessIcon,
  NoticeIcon,
} from "@netapp/bxp-style/react-icons/Notification";
import { useEffect, useMemo, useState } from "react";
import NotificationsTile from "@modules/home/components/NotificationsTile";
import { Show } from "@components/show/Show";
import DateCellRenderer from "@components/custom-cell-renderer/DateCellRenderer";

const NotificationsContent = ({
  setTotalNotifications,
}: NotificationsContentProps) => {
  const { selectedProjectId } = useSelectedProjectId();
  const [noticeBoardDetails, setNoticeBoardDetails] =
    useState<NoticeBoardDetailsType>();
  const [getNoticeBoardDetailsApi] = useLazyGetNoticeBoardDetailsQuery();

  useEffect(() => {
    if (selectedProjectId) {
      (async () => {
        const response = await getNoticeBoardDetailsApi({
          projectId: selectedProjectId,
        }).unwrap();
        setNoticeBoardDetails(response);
      })();
    }
  }, [selectedProjectId]);

  const totalNotifications = useMemo(() => {
    if (!noticeBoardDetails) return 0;

    const total = Object.values(noticeBoardDetails).reduce((sum, value) => {
      return sum + (typeof value === "number" ? value : (Array.isArray(value) ? value.length : 0));
    }, 0);
    setTotalNotifications(total);
    return total;
  }, [noticeBoardDetails, selectedProjectId]);

  const getSecurityNotifications = useMemo(() => {
    if (!noticeBoardDetails?.severityMessages) return null;
    return noticeBoardDetails.severityMessages.map((item, index) => {
      const message = typeof item === 'string' ? item : item.message;
      const timestamp = typeof item === 'object' && item.timestamp 
        ? item.timestamp
        : null;
      
      return (
        <Box 
          key={index} 
          className="flex items-start gap-3 p-3 mb-2 bg-red-50 border-l-4 border-red-400 rounded"
        >
          <Box className="flex-shrink-0 mt-0.5">
            <NoticeIcon color="error" size="small" />
          </Box>
          <Box className="flex-1 flex flex-col gap-1">
            <Text className="text-sm text-gray-800 leading-snug">
              {message}
            </Text>
            {timestamp && (
              <span className="text-xs text-gray-500">
                <DateCellRenderer 
                  value={new Date(timestamp).toISOString()} 
                  oneLineDate={true}
                  showSmallerDateFormat={false}
                />
              </span>
            )}
          </Box>
        </Box>
      );
    });
  }, [noticeBoardDetails?.severityMessages]);

  return (
    <CardContent className="flex gap-4 flex-col">
      <Box className="overflow-y-scroll px-3 h-[510px]">
        <Show>
          <Show.When isTrue={totalNotifications === 0}>
            <Box className="flex items-center h-full justify-around">
              <Text className="text-gray-500">No Data Available</Text>
            </Box>
          </Show.When>
          <Show.Else>
            <Box className="flex flex-col gap-4">
              <Show.When isTrue={noticeBoardDetails?.countErroredJobRuns > 0}>
                <NotificationsTile
                  title={`Failed Jobs/Errors(${noticeBoardDetails?.countErroredJobRuns})`}
                  content="Needs Attention. Not able to perform action further."
                  Icon={<ErrorIcon color="error" />}
                />
              </Show.When>
              <Show.When isTrue={noticeBoardDetails?.countBlockedCutoverJobRuns > 0}>
                <NotificationsTile
                  title={`Confirmation Pending (${noticeBoardDetails?.countBlockedCutoverJobRuns})`}
                  content="Awaiting Confirmation for final Cutover."
                  Icon={<InfoIcon />}
                />
              </Show.When>
              <Show.When isTrue={noticeBoardDetails?.countRecentJobConfigs > 0}>
                <NotificationsTile
                  title={`Recently Created Jobs(${noticeBoardDetails?.countRecentJobConfigs})`}
                  content="Jobs has been created successfully."
                  Icon={<LightBulbIcon />}
                />
              </Show.When>
              <Show.When isTrue={noticeBoardDetails?.countCompletedJobRuns > 0}>
                <NotificationsTile
                  title={`Recently Completed Jobs(${noticeBoardDetails?.countCompletedJobRuns})`}
                  content="Jobs has been completed successfully."
                  Icon={<SuccessIcon color="success" />}
                />
              </Show.When>
              <Show.When isTrue={noticeBoardDetails?.severityMessages.length > 0}>
                <NotificationsTile
                  title={`System Alerts (${noticeBoardDetails?.severityMessages.length})`}
                  content={<>{getSecurityNotifications}</>}
                  Icon={<NoticeIcon color="error" />}
                />
              </Show.When>
            </Box>
          </Show.Else>
        </Show>
      </Box>
    </CardContent>
  );
};

export default NotificationsContent;
