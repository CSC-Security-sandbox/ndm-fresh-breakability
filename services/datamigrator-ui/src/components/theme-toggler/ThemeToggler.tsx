import { Text, Toggle } from "@netapp/bxp-design-system-react";
import { useSelector, useDispatch } from "react-redux";
import { setTheme } from "@/store/reducer/appSlice";
import { RootStateType } from "@/store/store";
import { Box } from "@mui/material";

const ThemeToggler = () => {
  const theme = useSelector((state: RootStateType) => state.appSlice.theme);
  const dispatch = useDispatch();

  const isLightTheme = theme === "light";

  const handleToggle = () => {
    const newTheme = isLightTheme ? "dark" : "light";
    dispatch(setTheme(newTheme));
  };

  return (
    <Text className="flex justify-normal gap-3 items-center">
      Theme:
      <Toggle value={isLightTheme} toggle={handleToggle}>
        {isLightTheme ? "Light" : "Dark"}
      </Toggle>
    </Text>
  );
};

export default ThemeToggler;
