// ================================================================
// Zonas geográficas de la hoja de rutas
// ================================================================
// Cada parada se clasifica en una zona con un código corto: una letra según
// hacia dónde cae desde la nave de Monda (O = hacia Marbella y la costa
// oeste, E = hacia Coín y Málaga, N = interior por la carretera de Ronda) y
// un número según lejanía (1 = lo más cercano). Sirve para ordenar las
// paradas sin vehículo y ver de un vistazo cuáles van juntas.
//
// La zona se saca del código postal de la dirección de la localización
// (la que Rentman ya tiene y con la que se monta el enlace de Maps). Si la
// dirección no trae código postal (o trae uno mal tecleado) se intenta por
// el nombre del sitio. Si tampoco, la parada queda "Sin zona".
//
// Para cambiar un sitio de zona basta con mover su línea de bloque aquí.

// Orden en el que salen las zonas en la hoja
const ORDEN_ZONAS = ['O1', 'O2', 'O3', 'O4', 'E1', 'E2', 'E3', 'E4', 'N1', 'N2', 'N3'];

// código postal -> [zona, nombre que se enseña]
const POR_CP = {
  // ── O1: Monda y bajada a Marbella ──
  '29110': ['O1', 'Monda'],
  '29610': ['O1', 'Ojén'], '29612': ['O1', 'Ojén'],
  '29611': ['O1', 'Istán'],
  '29600': ['O1', 'Marbella'], '29601': ['O1', 'Marbella'], '29602': ['O1', 'Marbella'], '29603': ['O1', 'Marbella'], '29663': ['O1', 'Marbella'],
  '29604': ['O1', 'Elviria / Cabopino'],
  '29660': ['O1', 'Nueva Andalucía / Banús'],
  // ── O2: San Pedro y Benahavís ──
  '29670': ['O2', 'San Pedro'], '29678': ['O2', 'San Pedro / Guadalmina'],
  '29679': ['O2', 'Benahavís'],
  // ── O3: Estepona ──
  '29680': ['O3', 'Estepona'], '29688': ['O3', 'Estepona'], '29689': ['O3', 'Estepona'], '29693': ['O3', 'Estepona'],
  // ── O4: Manilva, Casares y Cádiz (el resto de Cádiz va por provincia, más abajo) ──
  '29690': ['O4', 'Casares'],
  '29691': ['O4', 'Manilva'], '29692': ['O4', 'Manilva / Sabinillas'],
  '11310': ['O4', 'Sotogrande'], '11312': ['O4', 'Sotogrande / Guadiaro'], '11315': ['O4', 'Alcaidesa'],
  '11360': ['O4', 'San Roque'], '11300': ['O4', 'La Línea'], '11350': ['O4', 'Castellar'], '11370': ['O4', 'Los Barrios'], '11391': ['O4', 'Tarifa'],
  // ── E1: Coín y Alhaurín el Grande ──
  '29100': ['E1', 'Coín'], '29108': ['E1', 'Guaro'],
  '29120': ['E1', 'Alhaurín el Grande'],
  // ── E2: Mijas, Fuengirola, Benalmádena, Torremolinos y el valle del Guadalhorce ──
  '29649': ['E2', 'Mijas Costa'], '29650': ['E2', 'Mijas'], '29651': ['E2', 'Mijas Costa'],
  '29640': ['E2', 'Fuengirola'],
  '29630': ['E2', 'Benalmádena'], '29631': ['E2', 'Benalmádena'], '29639': ['E2', 'Benalmádena'],
  '29620': ['E2', 'Torremolinos'],
  '29130': ['E2', 'Alhaurín de la Torre'],
  '29570': ['E2', 'Cártama'], '29580': ['E2', 'Cártama'], '29569': ['E2', 'Pizarra'], '29560': ['E2', 'Pizarra'], '29500': ['E2', 'Álora'],
  // ── E3: Málaga capital (los 290xx van por regla, más abajo) ──
  '29140': ['E3', 'Málaga · Churriana'], '29590': ['E3', 'Málaga · Campanillas'], '29196': ['E3', 'Málaga'], '29150': ['E3', 'Almogía'],
  // ── E4: Axarquía (Granada y Almería van por provincia, más abajo) ──
  '29730': ['E4', 'Rincón de la Victoria'], '29738': ['E4', 'Rincón de la Victoria'], '29720': ['E4', 'Rincón de la Victoria'], '29197': ['E4', 'Totalán'],
  '29740': ['E4', 'Torre del Mar'], '29700': ['E4', 'Vélez-Málaga'], '29790': ['E4', 'Vélez-Málaga'], '29792': ['E4', 'Vélez-Málaga'], '29712': ['E4', 'La Viñuela'],
  '29780': ['E4', 'Nerja'], '29770': ['E4', 'Torrox'],
  // ── N1: Ronda y su sierra ──
  '29400': ['N1', 'Ronda'], '29350': ['N1', 'Arriate'], '29370': ['N1', 'Benaoján'], '29392': ['N1', 'Jimera de Líbar'],
  '29340': ['N1', 'Cañete la Real'], '29480': ['N1', 'Gaucín'],
  '29109': ['N1', 'Tolox'], '29567': ['N1', 'Alozaina'], '29566': ['N1', 'Casarabonela'], '29410': ['N1', 'Yunquera'], '29420': ['N1', 'El Burgo'],
  // ── N2: Antequera y su comarca ──
  '29200': ['N2', 'Antequera'], '29540': ['N2', 'Antequera'], '29315': ['N2', 'Archidona'], '29312': ['N2', 'Villanueva del Rosario'], '29327': ['N2', 'Teba'], '29320': ['N2', 'Campillos']
};

// Provincias enteras (dos primeras cifras del código postal) cuando el código no está en la tabla
const POR_PROVINCIA = {
  '11': ['O4', 'Cádiz'],
  '18': ['E4', 'Granada'], '04': ['E4', 'Almería'],
  '14': ['N3', 'Córdoba'], '41': ['N3', 'Sevilla'], '23': ['N3', 'Jaén'], '21': ['N3', 'Huelva'],
  '28': ['N3', 'Madrid'], '30': ['N3', 'Murcia'], '06': ['N3', 'Badajoz'], '13': ['N3', 'Ciudad Real']
};

// Por nombre, cuando no hay código postal válido. Orden importante: lo más concreto primero
// ("san pedro" antes que "marbella"). A propósito no está "malaga": aparece como provincia
// en casi todas las direcciones y clasificaría mal cualquier pueblo.
const POR_NOMBRE = [
  ['elviria', 'O1', 'Elviria / Cabopino'], ['cabopino', 'O1', 'Elviria / Cabopino'],
  ['nueva andalucia', 'O1', 'Nueva Andalucía / Banús'], ['banus', 'O1', 'Nueva Andalucía / Banús'],
  ['san pedro', 'O2', 'San Pedro'], ['guadalmina', 'O2', 'San Pedro / Guadalmina'], ['benahavis', 'O2', 'Benahavís'],
  ['estepona', 'O3', 'Estepona'],
  ['manilva', 'O4', 'Manilva'], ['sabinillas', 'O4', 'Manilva / Sabinillas'], ['duquesa', 'O4', 'Manilva'], ['casares', 'O4', 'Casares'],
  ['sotogrande', 'O4', 'Sotogrande'], ['san roque', 'O4', 'San Roque'], ['alcaidesa', 'O4', 'Alcaidesa'], ['gibraltar', 'O4', 'Gibraltar'], ['la linea', 'O4', 'La Línea'],
  ['alhaurin el grande', 'E1', 'Alhaurín el Grande'], ['coin', 'E1', 'Coín'],
  ['alhaurin de la torre', 'E2', 'Alhaurín de la Torre'],
  ['calahonda', 'E2', 'Mijas Costa'], ['riviera', 'E2', 'Mijas Costa'], ['cala de mijas', 'E2', 'Mijas Costa'], ['mijas', 'E2', 'Mijas'],
  ['fuengirola', 'E2', 'Fuengirola'], ['benalmadena', 'E2', 'Benalmádena'], ['torremolinos', 'E2', 'Torremolinos'],
  ['torre del mar', 'E4', 'Torre del Mar'], ['nerja', 'E4', 'Nerja'], ['velez', 'E4', 'Vélez-Málaga'],
  ['granada', 'E4', 'Granada'], ['almeria', 'E4', 'Almería'],
  ['ronda', 'N1', 'Ronda'], ['antequera', 'N2', 'Antequera'], ['cordoba', 'N3', 'Córdoba'], ['sevilla', 'N3', 'Sevilla'],
  ['ojen', 'O1', 'Ojén'], ['istan', 'O1', 'Istán'], ['monda', 'O1', 'Monda'], ['marbella', 'O1', 'Marbella']
];

const SIN_ZONA = { codigo: '', nombre: 'Sin zona', orden: 999 };

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function zona(codigo, nombre) {
  return { codigo, nombre, orden: ORDEN_ZONAS.indexOf(codigo) };
}

// direccion: texto con la dirección (el enlace de Maps de la parada, o la dirección
// escrita a mano en las paradas manuales). nombreSitio: nombre de la localización.
function zonaDeParada(direccion, nombreSitio) {
  let texto = String(direccion || '');
  const i = texto.indexOf('query=');
  if (i !== -1) { try { texto = decodeURIComponent(texto.slice(i + 6)); } catch (e) { texto = texto.slice(i + 6); } }

  // Códigos postales que aparezcan en la dirección (5 cifras sueltas, de 01000 a 52999)
  const cps = texto.match(/(?<!\d)(?:0[1-9]|[1-4]\d|5[0-2])\d{3}(?!\d)/g) || [];
  for (const cp of cps) {
    if (POR_CP[cp]) return zona(POR_CP[cp][0], POR_CP[cp][1]);
    if (/^290[0-2]\d$/.test(cp)) return zona('E3', 'Málaga');
  }
  // Nombre del sitio antes que la provincia: un código postal mal tecleado (26660 por 29660)
  // no debe mandar una parada de Marbella a "otra provincia".
  const t = normalizar(texto + ' ' + (nombreSitio || ''));
  for (const [clave, codigo, nombre] of POR_NOMBRE) {
    if (new RegExp('(^|[^a-z])' + clave + '([^a-z]|$)').test(t)) return zona(codigo, nombre);
  }
  for (const cp of cps) {
    const prov = POR_PROVINCIA[cp.slice(0, 2)];
    if (prov) return zona(prov[0], prov[1]);
  }
  return SIN_ZONA;
}

module.exports = { zonaDeParada, ORDEN_ZONAS };
