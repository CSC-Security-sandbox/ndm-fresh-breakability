import { InlineLoader } from "@netapp/bxp-design-system-react";
import { useState, useEffect } from "react";

const ReportsGeneratingLoader = () => {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return ".";
        return prev + ".";
      });
    }, 600);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="inline-flex items-center space-x-2 text-gray-700 font-medium">
      <InlineLoader />
      <span>
        Generating reports, please wait
        <span className="inline-block w-6">{dots}</span>
      </span>
    </div>
  );
};

export default ReportsGeneratingLoader;
