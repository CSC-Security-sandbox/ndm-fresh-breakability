import { Heading } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container/index";
import Settings from "@components/top-nav-bar/setting/Settings";
import UserDetails from "@components/top-nav-bar/user-details/UserDetails";

const EmptyNavBar = () => {
  return (
    <Box className="min-w-full bg-header-netapp-bg font-bold h-20 flex items-center justify-between p-5">
      <Heading
        level="20"
        className="flex gap-3 w-7/12"
        style={{ color: "white" }}
      >
        <img
          src="/netApp.svg"
          alt="netApp"
          height={70}
          width={110}
          className="filter-white-color"
        />
        Data Migrator
      </Heading>
      <Box className="w-3/12 flex-grow justify-end flex content-center">
        <Box className="flex gap-6 flex-row justify-end">
          <Settings />
          <UserDetails />
        </Box>
      </Box>
    </Box>
  );
};

export default EmptyNavBar;
