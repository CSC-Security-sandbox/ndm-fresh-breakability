export type RefreshButtonPropsType = {
  isLoading?: boolean;
  onRefresh: () => void;
  className?: string;
  containerClassName?: string;
  size?: "sm" | "md" | "lg";
  variant?: "icon" | "primary" | "secondary";
};
