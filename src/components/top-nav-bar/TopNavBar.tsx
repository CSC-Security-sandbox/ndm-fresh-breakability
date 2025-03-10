import { Heading } from "@netapp/bxp-design-system-react";
import Box from "@/components/container/Box";
import Divider from "@mui/material/Divider";
import UserDetails from "@components/top-nav-bar/user-details/UserDetails";
import SwitchProject from "@components/top-nav-bar/switch-project/SwitchProject";
import Settings from "./setting/Settings";
// import { useNavigate } from "react-router-dom";

const TopNavBar = () => {
  // const navigate = useNavigate();
  return (
    <Box className="min-w-full bg-header-netapp-bg font-bold h-20 flex items-center justify-between p-5">
      <Heading
        level="20"
        className="flex gap-3 w-7/12 cursor-pointer"
        style={{ color: "white" }}
        // onClick={() => navigate("/home")}
      >
        <img
          src={"/netApp.svg"}
          alt="netApp"
          height={70}
          width={110}
          className="filter-white-color"
        />
        Data Migrator
      </Heading>
      <Box className="w-3/12 flex-grow justify-end flex content-center">
        <Box className="flex gap-6 flex-row justify-end">
          <SwitchProject />
          <Divider orientation="vertical" className="bg-white" />
          <Settings />
          <UserDetails />
        </Box>
      </Box>
    </Box>
  );
};

export default TopNavBar;
