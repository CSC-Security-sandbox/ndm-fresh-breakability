import { Button } from "@netapp/bxp-design-system-react";
import Box from "@components/container/Box";
import { useLoadingDots } from "@hooks/useLoadingDots";
import { ReportsGeneratingLoaderPropsType } from "@components/ReportsGeneratingLoader/reports-generating-loader.types";

const ReportsGeneratingLoader = ({
  label,
}: ReportsGeneratingLoaderPropsType) => {
  const loadingDots = useLoadingDots();

  return (
    <Box
      className="flex items-center font-medium tracking-tight p-1 cursor-not-allowed text-[#A7A7A7] bg-[#E0E0E0]"
      style={{ paddingLeft: "10px", paddingRight: "20px" }}
      disabled
    >
      <Button variant="text" isSubmitting className="pr-1" />
      {label || "Generating reports, please wait"}
      <span className="w-0">{loadingDots}</span>
    </Box>
  );
};

export default ReportsGeneratingLoader;
