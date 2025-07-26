import { Button } from "@netapp/bxp-design-system-react";
import { RefreshIcon } from "@netapp/bxp-style/react-icons/Navigation";
import { RefreshButtonProps } from "@components/refresh-button/refresh-button.types";
import { sizeClasses } from "@components/refresh-button/refresh-button.constants";

const RefreshButton = ({
  isLoading = false,
  onRefresh,
  className,
  size = "sm",
  variant = "icon",
}: RefreshButtonProps) => {
  return (
    <Button
      variant={variant}
      isSubmitting={isLoading}
      onClick={!isLoading ? onRefresh : undefined}
      className={`${sizeClasses[size]} ${className || ""}`}
      disabled={isLoading}
    >
      <RefreshIcon />
    </Button>
  );
};

export default RefreshButton;

// // Basic usage (same as your original)
// <RefreshButton
//   isLoading={isLoading}
//   onRefresh={refetch}
// />

// // Custom styling
// <RefreshButton
//   isLoading={isLoading}
//   onRefresh={refetch}
//   size="md"
//   containerClassName="flex justify-start ml-4"
// />

// // Different variant
// <RefreshButton
//   isLoading={isLoading}
//   onRefresh={refetch}
//   variant="primary"
//   size="lg"
// />
