import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import SwipeableDrawer from "@mui/material/SwipeableDrawer";
import { useDispatch } from "react-redux";
import { setDrawerClose } from "@store/reducer/commonComponentSlice";
import "./SideDrawer.css";

const SideDrawer = () => {
  const drawerProps = useSelector(
    (state: RootStateType) => state.commonComponentSlice?.drawerProps
  );

  const dispatch = useDispatch();
  return (
    <SwipeableDrawer
      anchor="right"
      open={drawerProps.isOpen}
      onClose={() => dispatch(setDrawerClose())}
      onOpen={() => {}}
      PaperProps={{
        sx: {
          "&.MuiSwipeableDrawer-paper": {
            top: "5rem",
          },
        },
      }}
      sx={{
        "& .MuiDrawer-paper": {
          boxSizing: "border-box",
          position: "absolute",
        },
      }}
    >
      {drawerProps.content}
    </SwipeableDrawer>
  );
};

export default SideDrawer;
