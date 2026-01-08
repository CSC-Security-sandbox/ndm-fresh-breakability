import React, { ReactNode } from "react";
import { Notification } from "@netapp/bxp-design-system-react";
import ReactDOM from "react-dom/client";

interface NotifyProps {
  type: "info" | "error" | "warning" | "success";
  message: string | ReactNode;
  clearNotificationTime?: number;
}

const notificationStack: HTMLElement[] = [];

export const notify = (() => {
  const createNotification = ({
    type,
    message,
    clearNotificationTime,
  }: NotifyProps) => {
    const body = document.body;
    const notificationContainer = document.createElement("div");
    notificationContainer.style.position = "fixed";
    notificationContainer.style.right = "10px";
    notificationContainer.style.zIndex = "1400";
    body.appendChild(notificationContainer);

    const root = ReactDOM.createRoot(notificationContainer);

    const clearNotification = () => {
      root?.unmount();
      try {
        body.removeChild(notificationContainer);
        const index = notificationStack.indexOf(notificationContainer);
        if (index > -1) {
          notificationStack.splice(index, 1);
          updateNotificationPositions();
        }
      } catch (error) {
        console.error("Failed to remove notification container:", error);
      }
    };

    const updateNotificationPositions = () => {
      notificationStack.forEach((container, index) => {
        container.style.top = `${10 + index * 60}px`;
      });
    };

    notificationStack.push(notificationContainer);
    updateNotificationPositions();

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
        right: "10px",
        zIndex: 1400,
      },
      messageStyle: {},
      isGlobal: false,
    });
    if (clearNotificationTime !== 0) {
      setTimeout(clearNotification, clearNotificationTime || 2000);
    }
    root.render(notificationElement);
  };

  return {
    success: (message: string | ReactNode, clearNotificationTime?: number) =>
      createNotification({ type: "success", message, clearNotificationTime }),
    error: (message: string | ReactNode, clearNotificationTime?: number) =>
      createNotification({
        type: "error",
        message,
        clearNotificationTime: clearNotificationTime ?? 5000,
      }),
    warning: (message: string) =>
      createNotification({ type: "warning", message }),
    info: (message: string) => createNotification({ type: "info", message }),
  };
})();
