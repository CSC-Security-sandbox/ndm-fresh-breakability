/* eslint-disable */
import React, { useMemo } from "react";
import { TabHeader, TabLinks } from "@netapp/bxp-design-system-react";
import { HEADER_WITH_PATHNAME } from "./TabHeaderWrapper.constant";
import { Link, useLocation } from "react-router-dom";

const LinkWithActiveClass = (props: any) => {
  const { path, label, activeClassName, className, isActive, key } = props;
  return (
    <Link
      to={path}
      className={`${className} ${isActive && activeClassName}`}
      key={key}
    >
      {label}
    </Link>
  );
};

const TabHeaderWrapper = () => {
  const location = useLocation();
  const pathname = location.pathname;
  console.log("pathname", pathname);

  const { currantPath, blueXpTabHeaderProps } = useMemo(() => {
    const allKeys = Object.keys(HEADER_WITH_PATHNAME);
    const currantPath = allKeys.find((row) => pathname.includes(row)) || "";
    console.log("currantPath", currantPath);
    const blueXpTabHeaderProps = HEADER_WITH_PATHNAME[currantPath || ""];
    return { currantPath, blueXpTabHeaderProps };
  }, [pathname]);

  return (
    <>
      {currantPath && (
        <TabHeader
          Icon={blueXpTabHeaderProps?.tabIcon}
          label={blueXpTabHeaderProps?.tabLabel}
          key={Math.random()}
        >
          <TabLinks>
            {blueXpTabHeaderProps?.tabLinks?.map((tab) => {
              return (
                <LinkWithActiveClass
                  key={Math.random()}
                  path={tab?.path}
                  label={tab?.label}
                  isActive={pathname === tab?.path}
                />
              );
            })}
          </TabLinks>
        </TabHeader>
      )}
    </>
  );
};

export default TabHeaderWrapper;
