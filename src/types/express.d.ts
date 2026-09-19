import 'express';

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      email: string;
      globalRole: 'USER' | 'ADMIN';
      facultyId: string | null;
      careerId: string | null;
      isActive: boolean;
    }

    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
