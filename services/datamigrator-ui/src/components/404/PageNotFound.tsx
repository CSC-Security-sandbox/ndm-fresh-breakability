import AccessWrapper from "@auth/access-wrapper/AccessWrapper";

const NotFound = () => {
  return (
    <AccessWrapper
      title="404 - Page Not Found"
      content="Sorry, the page you are looking for does not exist. It might have been moved or deleted."
    />
  );
};

export default NotFound;
