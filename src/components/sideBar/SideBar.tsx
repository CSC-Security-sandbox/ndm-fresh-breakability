import { useEffect, useState } from "react";
import { Menu, MenuItem, Sidebar, SubMenu } from "react-pro-sidebar";
import { useNavigate } from "react-router-dom";
import { Box } from "../container";
import { MENU_ITEMS } from "./sidebar.constant";

const SideBar = () => {
  const navigate = useNavigate();
  const [activeMenuId, setActiveMenuId] = useState("1");
  const [collapseSidebar, setCollapseSidebar] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNavigation = (menu: any, menuId: string) => {
    navigate(menu?.path);
    setActiveMenuId(menuId);
  };

  useEffect(() => {
    handleRouteChange(window.location.pathname);
  }, []);

  const handleRouteChange = (url: string) => {
    const menuId = MENU_ITEMS.find((item) => item.path === url)?.id;
    setActiveMenuId(menuId || "1");
  };

  const handleMouseEnter = () => {
    setCollapseSidebar(false);
  };

  const handleMouseLeave = () => {
    setCollapseSidebar(true);
  };

  return (
    <Box
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="h-[calc(100vh-5rem)] flex shrink-0 shadow-[5px_5px_15px_-3px_rgba(0,_0,_0,_0.15)] z-50 text-main-nav-icon-text-selected"
    >
      <Sidebar
        collapsed={collapseSidebar}
        transitionDuration={700}
        backgroundColor="#ffff"
        color="#6F6F6F"
      >
        <Menu
          menuItemStyles={{
            button: ({ active }) => {
              return {
                backgroundColor: active ? "#F4FBFF" : "",
                color: active ? "#0067C5" : "#6F6F6F",
              };
            },
          }}
        >
          {MENU_ITEMS.map((item, index) =>
            item.subMenu ? (
              <SubMenu key={index} label={item.label} icon={item.icon}>
                {item.subMenu.map((subItem, subIndex) => (
                  <MenuItem
                    color=""
                    key={subIndex}
                    icon={subItem.icon}
                    onClick={() => handleNavigation(subItem, item.id)}
                    style={{
                      backgroundColor:
                        window.location.pathname === subItem.path
                          ? "#F4FBFF"
                          : "",
                    }}
                  >
                    {subItem.label}
                  </MenuItem>
                ))}
              </SubMenu>
            ) : (
              <MenuItem
                key={index}
                icon={item.icon}
                onClick={() => handleNavigation(item, item.id)}
                active={activeMenuId === item.id}
              >
                {item.label}
              </MenuItem>
            )
          )}
        </Menu>
      </Sidebar>
    </Box>
  );
};

export default SideBar;
