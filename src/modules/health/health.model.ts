export interface HealthStatusResponse {
  status: 'ok';
  service: string;
  environment: string;
  authJwksReachable: boolean;
}
