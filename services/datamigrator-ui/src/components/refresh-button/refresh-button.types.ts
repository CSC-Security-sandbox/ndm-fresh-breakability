export type RefreshButtonProps = {
  isLoading?: boolean;
  onRefresh: () => void;
  className?: string;
  containerClassName?: string;
  size?: "sm" | "md" | "lg";
  variant?: "icon" | "primary" | "secondary";
};
