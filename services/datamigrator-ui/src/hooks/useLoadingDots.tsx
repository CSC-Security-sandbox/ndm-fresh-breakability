import { useEffect, useState } from "react";

type loadingDotsPropsType = {
  interval?: number;
  maxDots?: number;
};

// Custom hook to create a loading dots effect
export const useLoadingDots = ({
  interval = 600,
  maxDots = 3,
}: loadingDotsPropsType = {}) => {
  const [loadingDots, setLoadingDots] = useState(".");

  useEffect(() => {
    const timer = setInterval(() => {
      setLoadingDots((prev) => (prev.length < maxDots ? prev + "." : "."));
    }, interval);

    return () => clearInterval(timer);
  }, [interval, maxDots]);

  return loadingDots;
};
