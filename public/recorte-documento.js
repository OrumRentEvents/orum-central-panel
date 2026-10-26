// Recorte de documentos (oct 2026): al subir la foto de una factura se queda
// solo la hoja, sin la mesa ni lo que haya alrededor. Lo usan la app móvil
// (Subir factura) y el panel (Facturas proveedores → Subir).
//
// recortarDocumento(file) abre una pantalla con la foto y las 4 esquinas de
// la hoja ya detectadas (la hoja suele ser lo más claro de la foto: umbral de
// Otsu + la mancha clara más grande). Se pueden mover con el dedo o el ratón.
// "Recortar" endereza la perspectiva y devuelve un JPEG de como mucho 2400 px
// de lado; "Usar foto entera" devuelve el archivo sin tocar. Devuelve una
// Promise<File>.
(function () {
  var LADO_MAX = 2400;

  function cargarImagen(file) {
    return new Promise(function (ok, ko) {
      var i = new Image();
      i.onload = function () { ok(i); };
      i.onerror = function () { ko(new Error('No se puede abrir la foto')); };
      i.src = URL.createObjectURL(file);
    });
  }

  // ── Detección de la hoja ──
  // Sobre una copia pequeña (lado largo 320 px): gris → umbral de Otsu →
  // componente clara más grande → esquinas por extremos de x+y y x−y.
  function detectarHoja(img) {
    var esc = Math.min(1, 320 / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * esc)), h = Math.max(1, Math.round(img.height * esc));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
    var px = ctx.getImageData(0, 0, w, h).data, n = w * h;
    var gris = new Uint8Array(n), hist = new Array(256).fill(0);
    for (var i = 0; i < n; i++) { var g = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0; gris[i] = g; hist[g]++; }
    // Otsu
    var suma = 0; for (var t = 0; t < 256; t++) suma += t * hist[t];
    var sumB = 0, wB = 0, mejor = 0, umbral = 128;
    for (t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (suma - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > mejor) { mejor = v; umbral = t; }
    }
    // Componente clara más grande (4-vecinos)
    var etiqueta = new Int32Array(n), pila = new Int32Array(n), mayor = 0, mayorTam = 0, actual = 0;
    for (i = 0; i < n; i++) {
      if (etiqueta[i] || gris[i] <= umbral) continue;
      actual++; var tam = 0, sp = 0; pila[sp++] = i; etiqueta[i] = actual;
      while (sp) {
        var p = pila[--sp]; tam++;
        var x = p % w, y = (p - x) / w;
        if (x > 0 && !etiqueta[p - 1] && gris[p - 1] > umbral) { etiqueta[p - 1] = actual; pila[sp++] = p - 1; }
        if (x < w - 1 && !etiqueta[p + 1] && gris[p + 1] > umbral) { etiqueta[p + 1] = actual; pila[sp++] = p + 1; }
        if (y > 0 && !etiqueta[p - w] && gris[p - w] > umbral) { etiqueta[p - w] = actual; pila[sp++] = p - w; }
        if (y < h - 1 && !etiqueta[p + w] && gris[p + w] > umbral) { etiqueta[p + w] = actual; pila[sp++] = p + w; }
      }
      if (tam > mayorTam) { mayorTam = tam; mayor = actual; }
    }
    var margen = function () { var mx = img.width * 0.05, my = img.height * 0.05; return [[mx, my], [img.width - mx, my], [img.width - mx, img.height - my], [mx, img.height - my]]; };
    // Si la mancha es casi nada o es toda la foto, no hay hoja clara: margen del 5 %
    if (!mayor || mayorTam < n * 0.12 || mayorTam > n * 0.97) return margen();
    var tl = null, tr = null, br = null, bl = null, sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
    for (i = 0; i < n; i++) {
      if (etiqueta[i] !== mayor) continue;
      x = i % w; y = (i - x) / w;
      var s = x + y, d = x - y;
      if (s < sMin) { sMin = s; tl = [x, y]; }
      if (s > sMax) { sMax = s; br = [x, y]; }
      if (d > dMax) { dMax = d; tr = [x, y]; }
      if (d < dMin) { dMin = d; bl = [x, y]; }
    }
    return [tl, tr, br, bl].map(function (q) { return [Math.min(img.width, (q[0] + 0.5) / esc), Math.min(img.height, (q[1] + 0.5) / esc)]; });
  }

  // ── Perspectiva ──
  // Homografía que lleva el rectángulo (0,0)-(W,H) al cuadrilátero de la foto.
  function homografia(W, H, q) {
    var dst = [[0, 0], [W, 0], [W, H], [0, H]], A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = dst[i][0], y = dst[i][1], u = q[i][0], v = q[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // Gauss con pivote parcial
    for (var c = 0; c < 8; c++) {
      var piv = c; for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      var tA = A[c]; A[c] = A[piv]; A[piv] = tA; var tb = b[c]; b[c] = b[piv]; b[piv] = tb;
      for (r = c + 1; r < 8; r++) { var f = A[r][c] / A[c][c]; for (var k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    var hh = new Array(8);
    for (c = 7; c >= 0; c--) { var s = b[c]; for (k = c + 1; k < 8; k++) s -= A[c][k] * hh[k]; hh[c] = s / A[c][c]; }
    return hh;
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function enderezar(img, q) {
    // Origen a como mucho 3000 px de lado (una foto de 12 MP en píxeles sueltos pesa demasiado)
    var e0 = Math.min(1, 3000 / Math.max(img.width, img.height));
    var sw = Math.round(img.width * e0), sh = Math.round(img.height * e0);
    var cs = document.createElement('canvas'); cs.width = sw; cs.height = sh;
    cs.getContext('2d').drawImage(img, 0, 0, sw, sh);
    var src = cs.getContext('2d').getImageData(0, 0, sw, sh).data;
    var qs = q.map(function (p) { return [p[0] * e0, p[1] * e0]; });
    var W = Math.max(dist(qs[0], qs[1]), dist(qs[3], qs[2])), H = Math.max(dist(qs[0], qs[3]), dist(qs[1], qs[2]));
    var e1 = Math.min(1, LADO_MAX / Math.max(W, H));
    W = Math.max(1, Math.round(W * e1)); H = Math.max(1, Math.round(H * e1));
    var m = homografia(W, H, qs);
    var cd = document.createElement('canvas'); cd.width = W; cd.height = H;
    var ctx = cd.getContext('2d'), out = ctx.createImageData(W, H), o = out.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var den = m[6] * x + m[7] * y + 1;
        var u = (m[0] * x + m[1] * y + m[2]) / den, v = (m[3] * x + m[4] * y + m[5]) / den;
        var x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0, j = (y * W + x) * 4;
        if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
        var i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        for (var ch = 0; ch < 3; ch++) {
          o[j + ch] = (src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx) * (1 - fy) + (src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx) * fy;
        }
        o[j + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return new Promise(function (ok) { cd.toBlob(ok, 'image/jpeg', 0.88); });
  }

  // ── Pantalla de ajuste ──
  var CSS = '.rd-fondo{position:fixed;inset:0;z-index:5000;background:#111;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;touch-action:none}' +
    '.rd-cab{padding:calc(12px + env(safe-area-inset-top)) 16px 8px;font-size:14px;text-align:center;color:rgba(255,255,255,.8)}' +
    '.rd-zona{flex:1;position:relative;min-height:0;margin:8px 16px}' +
    '.rd-zona img{position:absolute;user-select:none;-webkit-user-drag:none;pointer-events:none}' +
    '.rd-zona svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}' +
    '.rd-pie{display:flex;gap:10px;padding:10px 16px calc(14px + env(safe-area-inset-bottom))}' +
    '.rd-pie button{flex:1;padding:14px 8px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;border:none;font-family:inherit}' +
    '.rd-pie .sec{background:rgba(255,255,255,.12);color:#fff}.rd-pie .pri{background:#1D9E75;color:#fff}.rd-pie button:disabled{opacity:.5}';

  window.recortarDocumento = function (file) {
    if (!file || !/^image\//.test(file.type)) return Promise.resolve(file);
    return cargarImagen(file).then(function (img) {
      if (!document.getElementById('rd-css')) { var st = document.createElement('style'); st.id = 'rd-css'; st.textContent = CSS; document.head.appendChild(st); }
      var q = detectarHoja(img);
      var fondo = document.createElement('div'); fondo.className = 'rd-fondo';
      fondo.innerHTML = '<div class="rd-cab">Ajusta las esquinas a la hoja de la factura</div>' +
        '<div class="rd-zona"><img alt=""><svg><polygon fill="rgba(29,158,117,.18)" stroke="#1D9E75" stroke-width="2"></polygon></svg></div>' +
        '<div class="rd-pie"><button class="sec" data-rd="entera">Usar foto entera</button><button class="pri" data-rd="recortar">Recortar</button></div>';
      document.body.appendChild(fondo);
      var zona = fondo.querySelector('.rd-zona'), im = fondo.querySelector('img'), svg = fondo.querySelector('svg'), poli = fondo.querySelector('polygon');
      im.src = img.src;
      var NS = 'http://www.w3.org/2000/svg', asas = [];
      for (var i = 0; i < 4; i++) {
        var g = document.createElementNS(NS, 'g');
        g.innerHTML = '<circle r="26" fill="transparent"></circle><circle r="11" fill="rgba(29,158,117,.35)" stroke="#fff" stroke-width="2.5"></circle>';
        g.style.cursor = 'grab'; g.setAttribute('data-i', i);
        svg.appendChild(g); asas.push(g);
      }
      // Encaje de la foto en la zona (escala y desplazamiento)
      var E = { s: 1, x: 0, y: 0 };
      function encajar() {
        var zw = zona.clientWidth, zh = zona.clientHeight;
        E.s = Math.min(zw / img.width, zh / img.height);
        E.x = (zw - img.width * E.s) / 2; E.y = (zh - img.height * E.s) / 2;
        im.style.left = E.x + 'px'; im.style.top = E.y + 'px';
        im.style.width = img.width * E.s + 'px'; im.style.height = img.height * E.s + 'px';
        pintar();
      }
      function pintar() {
        poli.setAttribute('points', q.map(function (p) { return (E.x + p[0] * E.s) + ',' + (E.y + p[1] * E.s); }).join(' '));
        asas.forEach(function (a, k) { a.setAttribute('transform', 'translate(' + (E.x + q[k][0] * E.s) + ',' + (E.y + q[k][1] * E.s) + ')'); });
      }
      var arrastre = null;
      svg.addEventListener('pointerdown', function (e) {
        var a = e.target.closest('[data-i]'); if (!a) return;
        arrastre = +a.getAttribute('data-i'); svg.setPointerCapture(e.pointerId); e.preventDefault();
      });
      svg.addEventListener('pointermove', function (e) {
        if (arrastre === null) return;
        var r = zona.getBoundingClientRect();
        q[arrastre] = [Math.max(0, Math.min(img.width, (e.clientX - r.left - E.x) / E.s)), Math.max(0, Math.min(img.height, (e.clientY - r.top - E.y) / E.s))];
        pintar();
      });
      var soltar = function () { arrastre = null; };
      svg.addEventListener('pointerup', soltar); svg.addEventListener('pointercancel', soltar);
      window.addEventListener('resize', encajar);
      requestAnimationFrame(encajar);
      return new Promise(function (ok) {
        fondo.addEventListener('click', function (e) {
          var b = e.target.closest('[data-rd]'); if (!b) return;
          var cerrar = function (f) { window.removeEventListener('resize', encajar); fondo.remove(); ok(f); };
          if (b.getAttribute('data-rd') === 'entera') return cerrar(file);
          fondo.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
          b.textContent = 'Recortando…';
          // Un respiro para que se pinte "Recortando…" antes del cálculo
          setTimeout(function () {
            enderezar(img, q).then(function (blob) {
              cerrar(blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file);
            }).catch(function () { cerrar(file); });
          }, 30);
        });
      });
    }).catch(function () { return file; });
  };
})();
