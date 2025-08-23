export const prepareHeaders = (headers: Headers, { getState }: any) => {
  const state = getState();
  const token = state.authSlice?.accessToken;
  const projectId = localStorage.getItem("selected_project_id");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("projectId", `${projectId}`);
  }

  return headers;
};

export const structuredErrorResponse = (error: any) => {
  console.error("API Error:", error);
  return error?.data?.error || error?.data || error || {};
}