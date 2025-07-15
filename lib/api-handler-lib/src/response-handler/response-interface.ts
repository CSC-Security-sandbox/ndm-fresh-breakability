// services/admin-service/src/utils/response-handler/response-interface.ts
// 1 ApiResponse interface (unchanged, but can be generic)
export interface ApiResponse<T> {
  message: string;
  trackId: string;
  data?: {
    items?: T;
    meta?: {
      total?: number;
      page?: number;
      pageSize?: number;
      hasMore?: boolean;
    };
  };
  error?: {
    details?: any;
    correctiveAction?: string;
  };
}