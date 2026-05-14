import { z } from 'zod';

import { isPanamanianCedula, normalizeCedula } from '../../utils/cedula.js';

const trimmedString = z.string().trim();

const isEmail = (value: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
};

export const registerUserSchema = z.object({
  body: z.object({
    nombre: trimmedString.min(2, 'Nombre must be at least 2 characters.').max(100),
    apellido: trimmedString.min(2, 'Apellido must be at least 2 characters.').max(100),
    cedula: trimmedString
      .min(1, 'Cedula is required.')
      .transform(normalizeCedula)
      .refine(isPanamanianCedula, 'Cedula format is invalid.'),
    correo: trimmedString
      .email('Correo must be a valid email.')
      .max(254)
      .transform((value) => value.toLowerCase()),
    contrasenia: z
      .string()
      .min(8, 'Contrasenia must be at least 8 characters.')
      .max(128, 'Contrasenia must be at most 128 characters.')
      .regex(/[a-z]/, 'Contrasenia must contain a lowercase letter.')
      .regex(/[A-Z]/, 'Contrasenia must contain an uppercase letter.')
      .regex(/\d/, 'Contrasenia must contain a number.'),
  }),
});

export type RegisterUserSchemaBody = z.infer<typeof registerUserSchema>['body'];

export const loginUserSchema = z.object({
  body: z.object({
    identificador: trimmedString.min(1, 'Identificador is required.').refine(
      (value) => isEmail(value) || isPanamanianCedula(value),
      'Identificador must be a valid email or cedula.'
    ),
    contrasenia: trimmedString.min(1, 'Contrasenia is required.'),
  }),
});

export type LoginUserSchemaBody = z.infer<typeof loginUserSchema>['body'];
