import bcrypt from 'bcryptjs';

import { getPrismaClient } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { isPanamanianCedula, normalizeCedula } from '../../utils/cedula.js';
import { signAccessToken } from '../../utils/jwt.js';
import type { LoginUserInput, LoginUserResponse, RegisterUserInput, RegisterUserResponse } from './auth.types.js';

const passwordSaltRounds = 12;

interface UniqueConstraintErrorShape {
  code?: string;
}

const isUniqueConstraintError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as UniqueConstraintErrorShape).code === 'P2002'
  );
};

export const registerUser = async (input: RegisterUserInput): Promise<RegisterUserResponse> => {
  const prisma = getPrismaClient();
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ correo: input.correo }, { cedula: input.cedula }],
    },
    select: {
      correo: true,
      cedula: true,
    },
  });

  if (existingUser?.correo === input.correo) {
    throw new ApiError(409, 'Email is already registered.');
  }

  if (existingUser?.cedula === input.cedula) {
    throw new ApiError(409, 'Cedula is already registered.');
  }

  const passwordHash = await bcrypt.hash(input.contrasenia, passwordSaltRounds);

  try {
    const user = await prisma.user.create({
      data: {
        nombre: input.nombre,
        apellido: input.apellido,
        cedula: input.cedula,
        correo: input.correo,
        passwordHash,
      },
    });

    return {
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        cedula: user.cedula,
        correo: user.correo,
      },
      accessToken: signAccessToken({ userId: user.id, correo: user.correo }),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ApiError(409, 'User is already registered.');
    }

    throw error;
  }
};

export const loginUser = async (input: LoginUserInput): Promise<LoginUserResponse> => {
  const prisma = getPrismaClient();
  const { identificador, contrasenia } = input;

  const isCedula = isPanamanianCedula(identificador);
  const normalizedIdentificador = isCedula ? normalizeCedula(identificador) : identificador.toLowerCase();

  const whereClause = isCedula
    ? { cedula: normalizedIdentificador }
    : { correo: normalizedIdentificador };

  const user = await prisma.user.findFirst({
    where: whereClause,
    select: {
      id: true,
      nombre: true,
      apellido: true,
      cedula: true,
      correo: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new ApiError(401, 'Invalid credentials.');
  }

  const isValidPassword = await bcrypt.compare(contrasenia, user.passwordHash);

  if (!isValidPassword) {
    throw new ApiError(401, 'Invalid credentials.');
  }

  return {
    user: {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      cedula: user.cedula,
      correo: user.correo,
    },
    accessToken: signAccessToken({ userId: user.id, correo: user.correo }),
  };
};
