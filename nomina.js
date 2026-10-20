// Nómina URAC (listado de integrantes) y cargos del organigrama.
// Se usa solo para sugerir nombres al agregar integrantes; la nómina real vive en la base de datos.
export const NOMBRES = [
  'Miguel Vallejos Moraga', 'Fabián Escobar Astudillo', 'Daniela Herraz Castillo',
  'Sergio Santibáñez Pavez', 'José Maldonado Cornejo', 'Karen Avendaño Ferrari',
  'César Norambuena Lagos', 'Jeison Castro Carrasco', 'Daniel Valenzuela Soto',
  'Daniel Camu Albornoz', 'Sebastián Pinochet Villagrán', 'Bastián Galaz Retamal',
  'Estefanía Aliaga Aranda', 'Noemí Mora Morgado', 'Daniel Sánchez Caro',
  'Héctor Oliva Herrera', 'Benjamín Lizana Espinoza', 'Vicente González Rivera',
  'David Tapia Saavedra', 'Manuel Castillo Díaz', 'Paloma Arias Castañeda',
  'Nicolás Rojas Mora', 'David Aravena Neira', 'Samuel Ramírez Zamora', 'José Orrego Valdez'
];

export const CARGOS = [
  'Líder de Unidad', 'Jefe de Operaciones', 'Jefe de Planificación', 'Jefe de Logística',
  'Jefe de Administración y Finanzas', 'LUMED', 'Oficial de Seguridad',
  'Líder Alfa', 'Líder Bravo', 'Navegante', 'Técnico', 'Sanitario', 'Comunicaciones',
  'Operador de Rescate'
];

// Cargo sugerido y perfil en la app, según el organigrama.
export const SUGERIDO = {
  'César Norambuena Lagos': { cargo: 'Líder de Unidad', rol: 'lider' },
  'Daniel Camu Albornoz': { cargo: 'Jefe de Operaciones', rol: 'lider' },
  'Daniel Valenzuela Soto': { cargo: 'Jefe de Planificación', rol: 'rescatista' },
  'Jeison Castro Carrasco': { cargo: 'Jefe de Logística', rol: 'rescatista' },
  'Bastián Galaz Retamal': { cargo: 'LUMED', rol: 'rescatista' },
  'Fabián Escobar Astudillo': { cargo: 'Oficial de Seguridad', rol: 'rescatista' }
};

// Perfiles de cordada (los asigna solo el Líder o el Administrador).
// La cordada mínima es de 6 operadores (Procedimiento de Activación).
// El sexto puesto, "Apoyo", lo ocupa quien tenga ese perfil o, si no hay, cualquier disponible sin puesto.
export const CATEGORIAS = [
  { id: 'lider_cordada', nombre: 'Líder de cordada' },
  { id: 'navegante', nombre: 'Navegante' },
  { id: 'tecnico', nombre: 'Técnico' },
  { id: 'sanitario', nombre: 'Sanitario' },
  { id: 'comunicaciones', nombre: 'Comunicaciones' },
  { id: 'apoyo', nombre: 'Apoyo' }
];
export const CATEGORIA_LIBRE = 'apoyo';

// Cargos de mando: solo una persona puede tener cada uno.
export const CARGOS_UNICOS = [
  'Líder de Unidad', 'Jefe de Operaciones', 'Jefe de Planificación', 'Jefe de Logística',
  'Jefe de Administración y Finanzas', 'Líder Alfa', 'Líder Bravo', 'LUMED', 'Oficial de Seguridad'
];

// Gerencia (ve el detalle de los integrantes): se asigna sola según el cargo.
export const CARGOS_GERENCIA = [
  'Jefe de Operaciones', 'Jefe de Planificación', 'Jefe de Logística',
  'Jefe de Administración y Finanzas', 'Líder Alfa', 'Líder Bravo', 'LUMED'
];
