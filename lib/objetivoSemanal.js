// Objetivo semanal de ventas — compartido por el Informe Mensual (server.js) y
// el informe semanal a Dirección (lib/informeComerciales.js), para que ambos
// muestren siempre las mismas cifras.

// Ventas reales semanales de 2025 (semana ISO -> € facturados sin IVA), base del objetivo 2026.
const VENTAS_2025_SEMANAL = {
  1: 1558.94, 2: 2570.28, 3: 6221.8, 4: 6977.33, 5: 5412.8, 6: 4705.14, 7: 4070.7, 8: 2221.95,
  9: 2875.5, 10: 9890.0, 11: 2166.05, 12: 13783.16, 13: 14708.33, 14: 24337.35, 15: 5455.0, 16: 25400.77,
  17: 27792.95, 18: 36785.05, 19: 50888.39, 20: 45380.61, 21: 59440.08, 22: 55878.79, 23: 57477.44,
  24: 43258.23, 25: 57017.17, 26: 43041.15, 27: 51025.71, 28: 47679.71, 29: 31976.47, 30: 47509.53,
  31: 44264.3, 32: 35956.07, 33: 38735.9, 34: 33600.6, 35: 31724.23, 36: 59414.68, 37: 43971.66,
  38: 56860.26, 39: 82401.57, 40: 49584.61, 41: 42001.45, 42: 34606.64, 43: 12685.05, 44: 6773.78,
  45: 20416.86, 46: 11236.66, 47: 39931.67, 48: 9662.77, 49: 7195.3, 50: 8233.27, 51: 5127.82,
  52: 11496.28, 53: 46223.27
};
const CRECIMIENTO_OBJETIVO_INFORME = 0.20;

module.exports = { VENTAS_2025_SEMANAL, CRECIMIENTO_OBJETIVO_INFORME };
