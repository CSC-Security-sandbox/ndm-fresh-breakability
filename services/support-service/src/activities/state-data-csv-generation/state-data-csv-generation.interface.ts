export interface PrometheusResponse {
  status: 'success' | 'error';
  data?: {
    resultType: string;
    result: any[];
  };
  error?: string;
  errorType?: string;
}

export interface PrometheusMetrics {
  servicePods?: any[];
  allMetrics?: any[];
}
