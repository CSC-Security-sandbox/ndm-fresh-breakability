import { Button } from "@netapp/bxp-design-system-react";
import { useState, useEffect } from "react";
import Box from "@components/container/Box";

const ReportsGeneratingLoader = () => {
  const [loadingDots, setLoadingDots] = useState(".");

  useEffect(() => {
    const timer = setInterval(() => {
      setLoadingDots((prev) => (prev.length < 3 ? prev + "." : "."));
    }, 600);

    return () => clearInterval(timer);
  }, []);

  return (
    <Box
      className="buttons-module_primary__HC_JW"
      disabled
      style={{ paddingLeft: "10px", paddingRight: "20px" }}
    >
      <Button variant="text" isSubmitting className="pr-1" />
      Generating reports, please wait
      <span className="w-0">{loadingDots}</span>
    </Box>
  );
};

export default ReportsGeneratingLoader;
