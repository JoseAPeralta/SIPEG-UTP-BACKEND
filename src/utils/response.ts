export interface ApiSuccessResponse<TData> {
  success: true;
  message: string;
  data: TData;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  errors: unknown[];
}

export const successResponse = <TData>(message: string, data: TData): ApiSuccessResponse<TData> => {
  return {
    success: true,
    message,
    data,
  };
};

export const errorResponse = (message: string, errors: unknown[] = []): ApiErrorResponse => {
  return {
    success: false,
    message,
    errors,
  };
};
