CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "nombre" VARCHAR(100) NOT NULL,
  "apellido" VARCHAR(100) NOT NULL,
  "cedula" VARCHAR(30) NOT NULL,
  "correo" VARCHAR(254) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_cedula_key" ON "users"("cedula");

CREATE UNIQUE INDEX "users_correo_key" ON "users"("correo");
