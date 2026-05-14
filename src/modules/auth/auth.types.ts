export interface RegisterUserInput {
  nombre: string;
  apellido: string;
  cedula: string;
  correo: string;
  contrasenia: string;
}

export interface AuthUserResponse {
  id: string;
  nombre: string;
  apellido: string;
  cedula: string;
  correo: string;
}

export interface RegisterUserResponse {
  user: AuthUserResponse;
  accessToken: string;
}
