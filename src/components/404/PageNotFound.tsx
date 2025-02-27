const NotFound = () => {
  return (
    <div className="w-full flex flex-col items-center justify-center h-screen bg-gray-100 text-gray-800">
      <img src="/not-found.svg" className="w-1/4" />
      <h1 className="text-4xl font-bold mb-4">404 - Page Not Found</h1>
      <p className="text-lg">
        Sorry, the page you are looking for does not exist.
      </p>
    </div>
  );
};

export default NotFound;
