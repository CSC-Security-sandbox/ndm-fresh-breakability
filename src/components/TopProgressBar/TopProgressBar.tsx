import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import NProgress from "nprogress";
import "nprogress/nprogress.css";
import "./TopProgressbar.css";

export default function TopProgressBar() {
  const location = useLocation();
  useEffect(() => {
    NProgress.configure({
      showSpinner: false,
      easing: "ease",
      speed: 500,
      minimum: 0.1,
    });
  }, []);

  useEffect(() => {
    NProgress.start();

    const timer = setTimeout(() => NProgress.done(), 500);
    return () => clearTimeout(timer);
  }, [location]);

  return null;
}
