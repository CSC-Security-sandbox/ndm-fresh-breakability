export interface PrometheusResponse {
  status: 'success' | 'error';
  data?: {
    resultType: string;
    result: any[];
  };
  error?: string;
  errorType?: string;
}
