const panamanianCedulaRegex = /^(?:[1-9]|1[0-3]|E|N|PE|AV|PI)-[A-Z0-9]{1,4}-\d{1,6}$/;

export const normalizeCedula = (cedula: string): string => {
  return cedula.trim().toUpperCase();
};

export const isPanamanianCedula = (cedula: string): boolean => {
  return panamanianCedulaRegex.test(normalizeCedula(cedula));
};
