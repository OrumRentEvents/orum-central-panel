// Relé de correo para los informes de comerciales de ORUM Central.
//
// Railway bloquea el SMTP saliente, así que el servidor manda cada email por HTTPS
// a este script, que lo envía desde la cuenta de Google que lo publica
// (gerencia@orumevents.com).
//
// Instalación (una sola vez, con la sesión de gerencia@orumevents.com):
//   1. script.google.com → Nuevo proyecto → pegar este archivo.
//   2. Configuración del proyecto → Propiedades del script → añadir
//      TOKEN = <una clave larga aleatoria> (la misma que APPS_SCRIPT_MAIL_TOKEN en Railway).
//   3. Implementar → Nueva implementación → Tipo «Aplicación web»:
//      Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
//      Autorizar los permisos de Gmail cuando lo pida.
//   4. Copiar la URL (…/exec) a APPS_SCRIPT_MAIL_URL en Railway.

function doPost(e) {
  try {
    var datos = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || datos.token !== token) return respuesta({ ok: false, motivo: 'token no válido' });

    var para = [].concat(datos.para || []).join(',');
    if (!para || !datos.asunto || !datos.html) return respuesta({ ok: false, motivo: 'faltan para/asunto/html' });

    GmailApp.sendEmail(para, datos.asunto, datos.texto || '', {
      htmlBody: datos.html,
      name: datos.nombre || 'ORUM Central'
    });
    return respuesta({ ok: true });
  } catch (err) {
    return respuesta({ ok: false, motivo: String(err && err.message || err) });
  }
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
