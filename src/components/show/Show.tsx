import React, { Children, ReactNode } from "react";

interface ShowPropsType {
  children: ReactNode;
}

interface ShowWhenProps extends ShowPropsType {
  isTrue: boolean;
}

export const Show = (props: ShowPropsType) => {
  const whenComponents: ReactNode[] = [];
  let otherwise: ReactNode | null = null;

  Children.forEach(props.children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === Show.When && child.props.isTrue) {
        whenComponents.push(child);
      } else if (child.type === Show.Else) {
        otherwise = child;
      }
    }
  });

  return whenComponents.length > 0 ? whenComponents : otherwise;
};

Show.When = ({ isTrue, children }: ShowWhenProps) => isTrue && children;
Show.Else = ({ children }: ShowPropsType) => children;

// EXAMPLE TO USE COMPONENT
{
  /* <Show>
  <Show.When isTrue={false}>
    <p>1 This will be rendered if condition is true</p>
  </Show.When>
  <Show.When isTrue={false}>
    <p>2 This will be rendered if condition is true</p>
  </Show.When>
  <Show.Else>
    <p>This will be rendered if condition is false</p>
  </Show.Else>
</Show>; */
}
