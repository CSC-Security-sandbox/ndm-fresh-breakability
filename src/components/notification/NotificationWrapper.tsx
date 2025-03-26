import React, { ReactNode } from "react";
import { Notification } from "@netapp/bxp-design-system-react";
import ReactDOM from "react-dom/client";

interface NotifyProps {
  type: "info" | "error" | "warning" | "success";
  message: string | ReactNode;
  clearNotificationTime?: number;
}

export const notify = (() => {
  const createNotification = ({
    type,
    message,
    clearNotificationTime,
  }: NotifyProps) => {
    const body = document.body;
    const notificationContainer = document.createElement("div");
    body.appendChild(notificationContainer);

    const root = ReactDOM.createRoot(notificationContainer);

    const clearNotification = () => {
      root?.unmount();
      try {
        body.removeChild(notificationContainer);
      } catch (error) {
        console.error("Failed to remove notification container:", error);
      }
    };

    const notificationElement = React.createElement(Notification, {
      type,
      children: message,
      moreInfoClassName: "",
      moreInfo: null,
      onClose: clearNotification,
      className: "",
      style: {
        width: "400px",
        position: "fixed",
        top: "10px",
        right: "10px",
        zIndex: 1400,
      },
      messageStyle: {},
      isGlobal: false,
    });

    root.render(notificationElement);

    setTimeout(clearNotification, clearNotificationTime || 2000);
  };

  return {
    success: (message: string | ReactNode, clearNotificationTime?: number) =>
      createNotification({ type: "success", message, clearNotificationTime }),
    error: (message: string | ReactNode) =>
      createNotification({
        type: "error",
        message,
        clearNotificationTime: 5000,
      }),
    warning: (message: string) =>
      createNotification({ type: "warning", message }),
    info: (message: string) => createNotification({ type: "info", message }),
  };
})();
