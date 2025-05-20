import AccessWrapper from "@auth/access-wrapper/AccessWrapper";

const NoAccess = () => {
  return (
    <AccessWrapper
      title="403 - Forbidden Access"
      content="You are not authorized to view this page. Please reach out to your administrator for assistance."
    />
  );
};

export default NoAccess;
