const Box: React.FC<React.HTMLAttributes<HTMLDivElement>> = (props: any) => {
    return <div {...props}>{props.children}</div>;
};
  
export default Box;