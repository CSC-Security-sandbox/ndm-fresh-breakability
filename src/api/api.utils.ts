import Cookies from "js-cookie";

export const prepareHeaders = (headers: Headers) => {
  const token = Cookies.get("access_token");
  const projectId = localStorage.getItem("selected_project_id");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("projectId", `${projectId}`);
  }

  return headers;
};
