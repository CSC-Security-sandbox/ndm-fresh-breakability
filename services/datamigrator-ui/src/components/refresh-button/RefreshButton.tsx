import { Button } from "@netapp/bxp-design-system-react";
import { RefreshIcon } from "@netapp/bxp-style/react-icons/Navigation";
import { RefreshButtonPropsType } from "@components/refresh-button/refresh-button.types";
import { sizeClasses } from "@components/refresh-button/refresh-button.constants";

const RefreshButton = ({
  isLoading = false,
  onRefresh,
  className = "",
  size = "sm",
  variant = "icon",
}: RefreshButtonPropsType) => {
  return (
    <Button
      variant={variant}
      isSubmitting={isLoading}
      onClick={!isLoading ? onRefresh : undefined}
      className={`${sizeClasses[size]} ${className}`}
      disabled={isLoading}
    >
      <RefreshIcon />
    </Button>
  );
};

export default RefreshButton;
