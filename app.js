// ============================================
// 1. CONFIGURACIÓN SUPABASE — PEGA TUS DATOS AQUÍ
// ============================================
const SUPABASE_URL = 'https://pskarkddqnrizntgmbeq.supabase.co'; // ← TU PROJECT URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBza2Fya2RkcW5yaXpudGdtYmVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNTUzMTIsImV4cCI6MjEwNTkzMTMxMn0.Cd8ETU68fA-2kdmROlD2Ev-CDDrdOBus8MYJ9pIZgO4'; // ← TU ANON KEY

let supabaseClient = null;

// ============================================
// 2. VARIABLES GLOBALES
// ============================================
let usuarioActual = null;
let ventaActual = null;
let scanner = null;
let tipoVenta = 'preventa';
let conBebida = false;
let unidades = 1;
let formaPago = 'efectivo';
let modoPrueba = false;
let puntosEmpleado = 0;
let logrosDesbloqueados = [];
let forzarPreventa = false; // Nueva variable para controlar el botón desde Admin

// ============================================
// 3. INICIALIZACIÓN DE SUPABASE (al cargar la página)
// ============================================
window.addEventListener('load', () => {
  if (!window.supabase) { alert('⚠️ La librería de Supabase no cargó.'); return; }
  
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const urlParams = new URLSearchParams(window.location.search);
  const ticketCode = urlParams.get('ticket');

  // 1. SI ES UN CLIENTE ABRIENDO SU TICKET: Le mostramos su QR sin pedir clave
  if (ticketCode) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('ticket-screen').classList.remove('hidden');
    mostrarTicket(ticketCode);
    return;
  }

  // 2. SI ES EL EMPLEADO: Restaurar sesión normal
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) {
      usuarioActual = data.session.user;
      iniciarApp(); // Centraliza la carga de UI

      // Si el empleado llega a la app tras escanear con su cámara nativa
      if (urlParams.get('qr')) {
        showTab('escanear');
        document.getElementById('qr-reader').classList.add('hidden'); // Ocultar bloque de cámara web
        buscarVenta(urlParams.get('qr'));
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else if (urlParams.get('qr')) {
      // Guardamos el QR en memoria por si el empleado escanea pero no ha hecho login
      sessionStorage.setItem('pendingQR', urlParams.get('qr'));
      alert('🔒 Inicia sesión primero para procesar la entrega del código QR.');
    }
  }).catch(err => {
    console.error('Error al restaurar sesión:', err);
  });
});

// Función de carga centralizada
function iniciarApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  evaluarBotonPreventa(); // Validar la fecha
  cargarPuntos(); 
  cargarDashboard(); 
  cargarInventario(); 
  cargarReservas();
  if (typeof cargarAdmin === 'function') cargarAdmin();
}

// ============================================
// 4. AUTENTICACIÓN
// ============================================
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  if (!email || !password) {
    errorEl.textContent = '❌ Escribe tu correo y contraseña.';
    return;
  }

  if (!supabaseClient) {
    errorEl.textContent = '❌ Supabase no está listo.';
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) {
      errorEl.textContent = '❌ ' + error.message;
      return;
    }

    if (data && data.user) {
      usuarioActual = data.user;
      iniciarApp();

      // Revisar si el usuario escaneó un QR antes de iniciar sesión
      const pendingQR = sessionStorage.getItem('pendingQR');
      if (pendingQR) {
        sessionStorage.removeItem('pendingQR');
        showTab('escanear');
        document.getElementById('qr-reader').classList.add('hidden');
        buscarVenta(pendingQR);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

    } else {
      errorEl.textContent = '❌ No se recibió usuario. Intenta de nuevo.';
    }
  } catch (err) {
    errorEl.textContent = '❌ Error inesperado: ' + err.message;
  }
}

// ============================================
// 5. NAVEGACIÓN Y LÓGICA DE FECHAS
// ============================================
function showTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

  document.querySelector(`.nav-btn[onclick="showTab('${tab}')"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.remove('hidden');

  // Si salimos de la pestaña escanear, destruimos el escáner para liberar memoria
  if (tab !== 'escanear' && scanner) {
    scanner.clear();
    scanner = null;
    document.getElementById('qr-reader').innerHTML = ''; 
  }

  if (tab === 'escanear') {
    document.getElementById('qr-reader').classList.remove('hidden');
    document.getElementById('qr-result').classList.add('hidden');
    iniciarScanner();
  }
  
  if (tab === 'dashboard') cargarDashboard();
  if (tab === 'inventario') cargarInventario();
  if (tab === 'reservas') cargarReservas();
  if (tab === 'admin') cargarAdmin();
}

function evaluarBotonPreventa() {
  const hoy = new Date();
  // El mes es indexado en 0, por eso septiembre es el mes 8
  const esFechaPermitida = (hoy.getDate() === 25 && hoy.getMonth() === 8 && hoy.getFullYear() === 2026);
  const btnPreventa = document.getElementById('btn-preventa');

  if (btnPreventa) {
    if (esFechaPermitida || forzarPreventa) {
      btnPreventa.classList.remove('disabled');
    } else {
      btnPreventa.classList.add('disabled');
      if (tipoVenta === 'preventa') seleccionarTipo('evento'); // Cambia forzosamente
    }
  }
}

function toggleForzarPreventa() {
  forzarPreventa = !forzarPreventa;
  document.getElementById('btn-forzar-preventa').textContent = forzarPreventa ? 'Forzar OFF' : 'Forzar ON';
  evaluarBotonPreventa();
  alert(forzarPreventa ? '✅ Botón Preventa HABILITADO' : '❌ Botón Preventa DESHABILITADO (Sujeto a fecha)');
}

// ============================================
// 6. SELECCIÓN TÁCTIL DE PRODUCTOS
// ============================================
function seleccionarTipo(tipo) {
  if (tipo === 'preventa' && document.getElementById('btn-preventa').classList.contains('disabled')) return; // Bloquea el clic si está deshabilitado
  
  tipoVenta = tipo;
  document.getElementById('btn-preventa').classList.toggle('active', tipo === 'preventa');
  document.getElementById('btn-evento').classList.toggle('active', tipo === 'evento');
  calcularPrecio();
}

function seleccionarBebida(valor) {
  conBebida = valor;
  document.getElementById('btn-sin-bebida').classList.toggle('active', !valor);
  document.getElementById('btn-con-bebida').classList.toggle('active', valor);
  calcularPrecio();
}

function cambiarUnidades(delta) {
  unidades = Math.max(1, unidades + delta);
  document.getElementById('unidades-display').textContent = unidades;
  calcularPrecio();
}

function seleccionarPago(pago) {
  formaPago = pago;
  document.querySelectorAll('.pago-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`.pago-btn[onclick="seleccionarPago('${pago}')"]`).classList.add('active');
}

function calcularPrecio() {
  const precioBase = tipoVenta === 'preventa' ? 16000 : 20000;
  const precioBebida = conBebida ? 3000 : 0;
  const total = (precioBase + precioBebida) * unidades;
  const totalEl = document.getElementById('total-pago');
  if (totalEl) totalEl.textContent = '$' + total.toLocaleString();
  return total;
}

// ============================================
// 7. GENERAR QR Y VENTA (MENSAJES PERSONALIZADOS)
// ============================================
async function generarQR() {
  const nombre = document.getElementById('nombre-cliente').value.trim();
  const telefono = document.getElementById('telefono-cliente').value.trim();
  const enviarWa = document.getElementById('enviar-wa-venta').checked;

  if (!nombre) {
    alert('⚠️ Ingresa el nombre del cliente');
    return;
  }

  const total = calcularPrecio();
  const codigoQR = 'LC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

  const { data, error } = await supabaseClient
    .from('ventas')
    .insert({
      codigo_qr: codigoQR,
      nombre_cliente: nombre,
      telefono_cliente: telefono,
      unidades: unidades,
      con_bebida: conBebida,
      valor_total: total,
      forma_pago: formaPago,
      tipo: tipoVenta,
      estado: 'pagado',
      es_prueba: modoPrueba
    })
    .select();

  if (error) {
    alert('❌ Error: ' + error.message);
    return;
  }

  ventaActual = data[0];
  const ticketURL = `https://lechona-app.vercel.app/?ticket=${codigoQR}`;

  if (telefono && enviarWa) {
    // Definimos texto según el tipo de venta
    let txtPromo = "";
    if (tipoVenta === 'preventa') {
      txtPromo = `📢 *¡SÓLO POR HOY!* Recuerda que la preventa es únicamente hoy 25 de septiembre 2026. ¡Ahorras un 20% frente al precio del evento!\n\n`;
    }
    const txtGeneral = `🐷 *¿Tienes un evento?* Vendemos lechonas y cojines de lechona a partir de 15 porciones. Info al *3002423896*.\n\n`;

    const mensaje = `🍖 *Lechona - ${tipoVenta === 'preventa' ? 'Preventa' : 'Evento'}*\n\n` +
      `👤 Cliente: *${nombre}*\n` +
      `🍖 Porciones: *${unidades}*\n` +
      `🥤 Bebida: *${conBebida ? 'Sí' : 'No'}*\n` +
      `💰 Total pagado: *$${total.toLocaleString()}*\n\n` +
      `📱 *Abre este enlace para ver tu Ticket y QR de entrega:*\n${ticketURL}\n\n` +
      txtPromo + txtGeneral +
      `¡Gracias por tu compra! 🎉`;

    const whatsappURL = `https://wa.me/${telefono.replace(/\D/g, '')}?text=${encodeURIComponent(mensaje)}`;
    window.open(whatsappURL, '_blank');
  }

  mostrarCelebracion(nombre, total);
  sumarPuntos(10);

  document.getElementById('nombre-cliente').value = '';
  document.getElementById('telefono-cliente').value = '';
  unidades = 1;
  document.getElementById('unidades-display').textContent = '1';
  calcularPrecio();
  cargarDashboard();
  cargarInventario();
  cargarAdmin();
}

// ============================================
// 8. CELEBRACIÓN Y CONFETI
// ============================================
function mostrarCelebracion(nombre, total) {
  const modal = document.getElementById('celebration-modal');
  modal.classList.remove('hidden');
  document.getElementById('celebration-message').textContent =
    `Venta de $${total.toLocaleString()} para ${nombre}`;
  crearConfeti();
  setTimeout(() => modal.classList.add('hidden'), 3000);
}

function crearConfeti() {
  const colores = ['#ff6b35', '#ffd700', '#4caf50', '#2196f3', '#ff4081'];
  for (let i = 0; i < 30; i++) {
    const confeti = document.createElement('div');
    confeti.style.cssText = `
      position: fixed;
      width: 10px;
      height: 10px;
      background: ${colores[Math.floor(Math.random() * colores.length)]};
      left: ${Math.random() * 100}%;
      top: -10px;
      z-index: 1001;
      animation: confettiFall ${1 + Math.random() * 2}s linear forwards;
      border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
    `;
    document.body.appendChild(confeti);
    setTimeout(() => confeti.remove(), 3000);
  }
}

function cerrarCelebracion() {
  document.getElementById('celebration-modal').classList.add('hidden');
}

// ============================================
// 9. RESERVAS
// ============================================
async function crearReserva() {
  const nombre = document.getElementById('nombre-cliente').value.trim();
  const telefono = document.getElementById('telefono-cliente').value.trim();

  if (!nombre) {
    alert('⚠️ Ingresa el nombre del cliente');
    return;
  }

  const { error } = await supabaseClient
    .from('ventas')
    .insert({
      codigo_qr: 'RES-' + Date.now(),
      nombre_cliente: nombre,
      telefono_cliente: telefono,
      unidades: unidades,
      con_bebida: conBebida,
      valor_total: 0,
      forma_pago: 'otro',
      tipo: 'reserva',
      estado: 'reservado',
      es_prueba: modoPrueba
    });

  if (error) {
    alert('❌ Error: ' + error.message);
    return;
  }

  mostrarCelebracion(nombre, 0);
  sumarPuntos(5);

  document.getElementById('nombre-cliente').value = '';
  document.getElementById('telefono-cliente').value = '';
  unidades = 1;
  document.getElementById('unidades-display').textContent = '1';
  calcularPrecio();
  cargarReservas();
  cargarDashboard();
  cargarAdmin();
}

// ============================================
// 10. ESCANEAR QR (NUEVO MÉTODO ANTI-BLOQUEOS)
// ============================================
function iniciarScanner() {
  if (scanner) return;
  
  // Usamos el Scanner UI por defecto para que el usuario pueda dar clic y autorizar la cámara
  scanner = new Html5QrcodeScanner(
    "qr-reader",
    { fps: 10, qrbox: { width: 250, height: 250 } },
    false // desactiva logs molestos
  );

  scanner.render(onScanSuccess, onScanError);
}

function onScanSuccess(decodedText) {
  try {
    let codigo = null;
    
    if (decodedText.includes('?qr=')) {
      const url = new URL(decodedText.startsWith('http') ? decodedText : 'https://' + decodedText);
      codigo = url.searchParams.get('qr');
    } else if (decodedText.startsWith('{')) {
      const data = JSON.parse(decodedText);
      codigo = data.codigo;
    } else {
      codigo = decodedText;
    }

    if (codigo) {
      document.getElementById('qr-reader').classList.add('hidden'); // Ocultar cámara para ver resultado
      buscarVenta(codigo);
    }
  } catch (e) {
    // Si lee basura, ignorarlo silenciosamente
  }
}

function onScanError(err) {
  // Silencioso
}

async function buscarVenta(codigo) {
  const { data, error } = await supabaseClient
    .from('ventas')
    .select('*')
    .eq('codigo_qr', codigo)
    .single();

  if (error || !data) {
    alert('❌ Venta no encontrada');
    document.getElementById('qr-reader').classList.remove('hidden'); // Restaurar cámara
    return;
  }

  ventaActual = data;

  document.getElementById('qr-result').classList.remove('hidden');
  document.getElementById('res-nombre').textContent = data.nombre_cliente;

  document.getElementById('res-detalles').innerHTML = `
    🍖 Porciones: <strong>${data.unidades}</strong><br>
    🥤 Bebida: <strong>${data.con_bebida ? 'Sí' : 'No'}</strong><br>
    💰 Total: <strong>$${data.valor_total.toLocaleString()}</strong>
  `;

  const estadoEl = document.getElementById('res-estado');
  const btnEntregar = document.getElementById('btn-entregar');
  const resultIcon = document.getElementById('result-icon');
  const inputNombre = document.getElementById('nombre-entrega');
  const waLabel = document.getElementById('wa-entrega-label');

  if (data.estado === 'entregado') {
    const fechaEntrega = new Date(data.fecha_entrega);
    const fechaFormateada = fechaEntrega.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
    const horaFormateada = fechaEntrega.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    resultIcon.textContent = '⚠️';
    estadoEl.innerHTML = `
      ⚠️ YA ENTREGADO<br>
      <small>Entregado a <strong>${data.nombre_cliente}</strong><br>
      por <strong>${data.entregado_por || 'Empleado'}</strong><br>
      el <strong>${fechaFormateada}</strong> a las <strong>${horaFormateada}</strong></small>
    `;
    estadoEl.style.color = '#e74c3c';
    btnEntregar.style.display = 'none';
    inputNombre.style.display = 'none';
    waLabel.style.display = 'none';
  } else {
    resultIcon.textContent = '✅';
    estadoEl.textContent = '✅ Pendiente de entrega';
    estadoEl.style.color = '#4caf50';
    btnEntregar.style.display = 'block';
    inputNombre.style.display = 'block';
    waLabel.style.display = 'flex';
  }
}

// ============================================
// 11. MARCAR COMO ENTREGADO (MENSAJES PERSONALIZADOS)
// ============================================
async function marcarEntregado() {
  if (!ventaActual) return;

  const nombreEmpleado = document.getElementById('nombre-entrega').value.trim() || usuarioActual.email;
  const fechaEntrega = new Date().toISOString();
  const enviarWaEntrega = document.getElementById('enviar-wa-entrega').checked;

  const { error } = await supabaseClient
    .from('ventas')
    .update({
      estado: 'entregado',
      fecha_entrega: fechaEntrega,
      entregado_por: nombreEmpleado
    })
    .eq('id', ventaActual.id);

  if (error) {
    alert('❌ Error: ' + error.message);
    return;
  }

  await supabaseClient.from('entregas').insert({
    venta_id: ventaActual.id,
    empleado: nombreEmpleado,
    fecha: fechaEntrega
  });

  if (ventaActual.telefono_cliente && enviarWaEntrega) {
    let txtPromo = "";
    if (ventaActual.tipo === 'preventa') {
      txtPromo = `📢 *¡SÓLO POR HOY!* La preventa es únicamente hoy 25 de septiembre 2026. ¡Ahorras un 20% frente al evento!\n\n`;
    }
    const txtGeneral = `🐷 *¿Planeas un evento próximamente?* Recuerda que vendemos espectaculares lechonas y cojines de lechona a partir de 15 porciones. Info al *3002423896*.\n\n`;

    const mensajeEntrega = `✅ *¡Tu pedido ha sido entregado!*\n\n` +
      `Hola ${ventaActual.nombre_cliente}, esperamos que disfrutes tu deliciosa lechona. 🤤\n\n` +
      txtPromo + txtGeneral +
      `¡Mil gracias por tu compra! 🎉`;

    const whatsappURL = `https://wa.me/${ventaActual.telefono_cliente.replace(/\D/g, '')}?text=${encodeURIComponent(mensajeEntrega)}`;
    window.open(whatsappURL, '_blank');
  }

  sumarPuntos(15);
  
  // Limpiar panel de resultados y reactivar cámara
  document.getElementById('qr-result').classList.add('hidden');
  document.getElementById('qr-reader').classList.remove('hidden');
  document.getElementById('nombre-entrega').value = '';

  alert('✅ Entrega registrada correctamente');
  cargarDashboard();
  cargarInventario();
  cargarAdmin();
}

function cerrarResultado() {
  document.getElementById('qr-result').classList.add('hidden');
  document.getElementById('qr-reader').classList.remove('hidden');
}

// ============================================
// 12. DASHBOARD
// ============================================
async function cargarDashboard() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const { data, error } = await supabaseClient
    .from('ventas')
    .select('*')
    .gte('fecha_creacion', hoy.toISOString())
    .order('fecha_creacion', { ascending: false });

  if (error) return;

  let totalUnidades = 0;
  let totalVentas = 0;
  let totalEntregados = 0;
  let totalReservas = 0;
  const ventasPorHora = Array(12).fill(0);
  const pagosPorMetodo = {};

  data.forEach(venta => {
    totalUnidades += venta.unidades;
    totalVentas += venta.valor_total;

    if (venta.estado === 'entregado') totalEntregados++;
    if (venta.estado === 'reservado') totalReservas++;

    const hora = new Date(venta.fecha_creacion).getHours();
    if (hora >= 8 && hora < 20) {
      ventasPorHora[hora - 8]++;
    }

    if (pagosPorMetodo[venta.forma_pago]) {
      pagosPorMetodo[venta.forma_pago]++;
    } else {
      pagosPorMetodo[venta.forma_pago] = 1;
    }
  });

  document.getElementById('dash-unidades').textContent = totalUnidades;
  document.getElementById('dash-ventas').textContent = '$' + totalVentas.toLocaleString();
  document.getElementById('dash-entregados').textContent = totalEntregados;
  document.getElementById('dash-reservas').textContent = totalReservas;

  const chartHoras = document.getElementById('chart-horas');
  chartHoras.innerHTML = '';
  const maxVentas = Math.max(...ventasPorHora, 1);

  ventasPorHora.forEach((cantidad, index) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const altura = Math.max((cantidad / maxVentas) * 100, 2);
    bar.style.height = altura + '%';
    bar.innerHTML = `<span class="bar-label">${index + 8}h</span>`;
    if (cantidad > 0) bar.title = `${cantidad} venta(s)`;
    chartHoras.appendChild(bar);
  });

  const chartPagos = document.getElementById('chart-pagos');
  chartPagos.innerHTML = '';
  const coloresPago = { 'efectivo': '#4caf50', 'nequi': '#2196f3', 'daviplata': '#ff9800', 'transferencia': '#9c27b0', 'otro': '#607d8b' };

  Object.keys(pagosPorMetodo).forEach(metodo => {
    const segment = document.createElement('div');
    segment.className = 'pie-segment';
    segment.innerHTML = `
      <div class="pie-color" style="background: ${coloresPago[metodo] || '#999'}"></div>
      <div>${metodo}</div>
      <div><strong>${pagosPorMetodo[metodo]}</strong></div>
    `;
    chartPagos.appendChild(segment);
  });

  const recentSales = document.getElementById('recent-sales-list');
  recentSales.innerHTML = '';
  data.slice(0, 10).forEach(venta => {
    const div = document.createElement('div');
    div.className = 'recent-sale-item';
    div.innerHTML = `
      <div class="sale-info">
        <strong>${venta.nombre_cliente}</strong>
        <span>${venta.unidades} porc. | ${venta.forma_pago} | ${venta.estado}</span>
      </div>
      <div class="sale-amount">$${venta.valor_total.toLocaleString()}</div>
    `;
    recentSales.appendChild(div);
  });
}

// ============================================
// 13. INVENTARIO
// ============================================
async function cargarInventario() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const { data: ventas, error } = await supabaseClient
    .from('ventas')
    .select('*')
    .gte('fecha_creacion', hoy.toISOString());

  if (error) return;

  let vendidasPreventa = 0;
  let vendidasEvento = 0;
  let vendidasBebidas = 0;

  ventas.forEach(venta => {
    if (venta.tipo === 'preventa') vendidasPreventa += venta.unidades;
    if (venta.tipo === 'evento') vendidasEvento += venta.unidades;
    if (venta.con_bebida) vendidasBebidas += venta.unidades;
  });

  const { data: inventario } = await supabaseClient
    .from('inventario')
    .select('*')
    .eq('fecha', new Date().toISOString().split('T')[0])
    .single();

  const totalLechona = inventario?.total_lechona || 50;
  const totalBebidas = inventario?.total_bebidas || 30;

  document.getElementById('stock-preventa').textContent = Math.max(totalLechona - vendidasPreventa, 0);
  document.getElementById('stock-evento').textContent = Math.max(totalLechona - vendidasEvento, 0);
  document.getElementById('stock-bebidas').textContent = Math.max(totalBebidas - vendidasBebidas, 0);

  const totalVendido = vendidasPreventa + vendidasEvento;
  const porcentaje = (totalVendido / totalLechona) * 100;
  document.getElementById('progress-lechona').style.width = Math.min(porcentaje, 100) + '%';
  document.getElementById('vendido-lechona').textContent = totalVendido;
  document.getElementById('disponible-lechona').textContent = Math.max(totalLechona - totalVendido, 0);
}

async function guardarInventario() {
  const totalLechona = parseInt(document.getElementById('config-total-lechona').value) || 50;
  const totalBebidas = parseInt(document.getElementById('config-total-bebidas').value) || 30;
  const hoy = new Date().toISOString().split('T')[0];

  const { error } = await supabaseClient
    .from('inventario')
    .upsert({
      fecha: hoy,
      total_lechona: totalLechona,
      total_bebidas: totalBebidas,
      actualizado_por: usuarioActual.email
    });

  if (error) {
    alert('❌ Error: ' + error.message);
  } else {
    alert('✅ Inventario guardado correctamente');
    cargarInventario();
  }
}

// ============================================
// 14. RESERVAS
// ============================================
async function cargarReservas() {
  const { data, error } = await supabaseClient
    .from('ventas')
    .select('*')
    .eq('estado', 'reservado')
    .order('fecha_creacion', { ascending: true });

  if (error) return;

  const contenedor = document.getElementById('lista-reservas');
  contenedor.innerHTML = '';

  if (data.length === 0) {
    contenedor.innerHTML = '<p style="color: #333; text-align: center; font-size: 18px; margin-top: 30px;">No hay reservas pendientes 🎉</p>';
    return;
  }

  data.forEach(reserva => {
    const div = document.createElement('div');
    div.className = 'reserva-card';
    div.innerHTML = `
      <div class="reserva-header">
        <span class="reserva-nombre">👤 ${reserva.nombre_cliente}</span>
        <span class="reserva-estado">PENDIENTE</span>
      </div>
      <p>🍖 Porciones: ${reserva.unidades}</p>
      <p>📱 Tel: ${reserva.telefono_cliente || 'No registrado'}</p>
      <button class="btn-touch btn-success" onclick="entregarReserva('${reserva.id}')">✅ Entregar</button>
    `;
    contenedor.appendChild(div);
  });
}

async function entregarReserva(id) {
  const { error } = await supabaseClient
    .from('ventas')
    .update({
      estado: 'entregado',
      fecha_entrega: new Date().toISOString(),
      entregado_por: usuarioActual.email
    })
    .eq('id', id);

  if (!error) {
    sumarPuntos(15);
    alert('✅ Reserva entregada');
    cargarReservas();
    cargarDashboard();
    cargarInventario();
    cargarAdmin();
  }
}

// ============================================
// 15. GAMIFICACIÓN
// ============================================
function sumarPuntos(puntos) {
  puntosEmpleado += puntos;
  document.getElementById('puntos-empleado').textContent = puntosEmpleado;
  localStorage.setItem('puntos_' + usuarioActual.email, puntosEmpleado);
  verificarLogros();
}

function cargarPuntos() {
  puntosEmpleado = parseInt(localStorage.getItem('puntos_' + usuarioActual.email)) || 0;
  document.getElementById('puntos-empleado').textContent = puntosEmpleado;
  cargarLogros();
}

function verificarLogros() {
  const logros = [
    { id: 'primera-venta', nombre: '🎯 Primera Venta', descripcion: 'Realiza tu primera venta', condicion: puntosEmpleado >= 10 },
    { id: 'vendedor-10', nombre: '⭐ Vendedor Novato', descripcion: 'Acumula 50 puntos', condicion: puntosEmpleado >= 50 },
    { id: 'vendedor-100', nombre: '🏆 Vendedor Experto', descripcion: 'Acumula 100 puntos', condicion: puntosEmpleado >= 100 },
    { id: 'vendedor-500', nombre: '👑 Leyenda de Ventas', descripcion: 'Acumula 500 puntos', condicion: puntosEmpleado >= 500 }
  ];

  logros.forEach(logro => {
    if (logro.condicion && !logrosDesbloqueados.includes(logro.id)) {
      logrosDesbloqueados.push(logro.id);
      localStorage.setItem('logros_' + usuarioActual.email, JSON.stringify(logrosDesbloqueados));
      mostrarLogroDesbloqueado(logro);
    }
  });
}

function cargarLogros() {
  logrosDesbloqueados = JSON.parse(localStorage.getItem('logros_' + usuarioActual.email)) || [];
}

function mostrarLogroDesbloqueado(logro) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="celebration-emoji">🏆</div>
      <h3>¡Logro Desbloqueado!</h3>
      <p><strong>${logro.nombre}</strong></p>
      <p>${logro.descripcion}</p>
      <button class="btn-touch btn-primary" onclick="this.parentElement.parentElement.remove()">¡Genial!</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function mostrarLogros() {
  const modal = document.getElementById('logros-modal');
  const lista = document.getElementById('logros-list');
  const todosLogros = [
    { id: 'primera-venta', nombre: '🎯 Primera Venta', descripcion: 'Realiza tu primera venta' },
    { id: 'vendedor-10', nombre: '⭐ Vendedor Novato', descripcion: 'Acumula 50 puntos' },
    { id: 'vendedor-100', nombre: '🏆 Vendedor Experto', descripcion: 'Acumula 100 puntos' },
    { id: 'vendedor-500', nombre: '👑 Leyenda de Ventas', descripcion: 'Acumula 500 puntos' }
  ];

  lista.innerHTML = '';
  todosLogros.forEach(logro => {
    const desbloqueado = logrosDesbloqueados.includes(logro.id);
    const div = document.createElement('div');
    div.style.cssText = `
      padding: 10px;
      margin: 5px 0;
      border-radius: 8px;
      background: ${desbloqueado ? '#e8f5e9' : '#f5f5f5'};
      opacity: ${desbloqueado ? '1' : '0.5'};
    `;
    div.innerHTML = `
      <strong>${logro.nombre}</strong>
      <p style="font-size: 12px;">${logro.descripcion}</p>
      ${desbloqueado ? '✅ Desbloqueado' : '🔒 Bloqueado'}
    `;
    lista.appendChild(div);
  });
  modal.classList.remove('hidden');
}

function cerrarLogros() {
  document.getElementById('logros-modal').classList.add('hidden');
}

// ============================================
// 16. MODO PRUEBA
// ============================================
async function toggleModoPrueba() {
  modoPrueba = !modoPrueba;
  const toggle = document.querySelector('.test-mode-toggle');
  const banner = document.getElementById('test-mode-banner');
  const indicator = document.getElementById('test-indicator');
  const label = document.getElementById('test-label');

  if (modoPrueba) {
    toggle.classList.add('active');
    banner.classList.remove('hidden');
    indicator.textContent = '🧪';
    label.textContent = 'ON';
    alert('🧪 Modo Prueba ACTIVADO\n\nTodo lo que registres ahora se eliminará al desactivar el modo prueba.');
  } else {
    toggle.classList.remove('active');
    banner.classList.add('hidden');
    indicator.textContent = '🧪';
    label.textContent = 'Prueba';

    const { error } = await supabaseClient
      .from('ventas')
      .delete()
      .eq('es_prueba', true);

    if (!error) {
      alert('🧹 Datos de prueba eliminados correctamente');
    } else {
      alert('❌ Error al borrar datos de prueba: ' + error.message);
    }
    cargarDashboard();
    cargarInventario();
    cargarReservas();
    cargarAdmin();
  }
}

// ============================================
// 17. TICKET DIGITAL DEL CLIENTE
// ============================================
async function mostrarTicket(codigo) {
  const { data, error } = await supabaseClient.from('ventas').select('*').eq('codigo_qr', codigo).single();

  if (error || !data) {
    document.getElementById('ticket-detalles').innerHTML = '<p style="color:red; font-weight:bold;">❌ Pedido no encontrado.</p>';
    document.getElementById('ticket-qr').style.display = 'none';
    return;
  }

  document.getElementById('ticket-nombre').textContent = data.nombre_cliente;

  const qrDataParaEmpleado = `https://lechona-app.vercel.app/?qr=${codigo}`;
  document.getElementById('ticket-qr').src = `https://quickchart.io/qr?text=${encodeURIComponent(qrDataParaEmpleado)}&size=300`;

  let estadoHTML = data.estado === 'entregado' 
    ? '<span style="color: #e74c3c; font-weight: bold;">⚠️ YA ENTREGADO</span>'
    : '<span style="color: #4caf50; font-weight: bold;">✅ LISTO PARA RECOGER</span>';

  document.getElementById('ticket-detalles').innerHTML = `
    🍖 Porciones: <strong>${data.unidades}</strong><br>
    🥤 Bebida: <strong>${data.con_bebida ? 'Sí' : 'No'}</strong><br>
    💰 Estado: ${estadoHTML}
  `;
}

// ============================================
// 18. FUNCIONES DE ADMINISTRACIÓN
// ============================================
async function cargarAdmin() {
  const { data, error } = await supabaseClient.from('ventas').select('*').order('fecha_creacion', { ascending: false });
  const lista = document.getElementById('admin-sales-list');
  if (!lista) return;
  lista.innerHTML = '';
  
  if (error || !data) return;

  data.forEach(v => {
    const div = document.createElement('div');
    div.className = 'recent-sale-item';
    div.innerHTML = `
      <div class="sale-info" style="flex:1;">
        <strong>${v.nombre_cliente}</strong>
        <span>${v.unidades} porc. | ${v.tipo.toUpperCase()} | <span style="color:${v.estado === 'entregado' ? '#e74c3c' : '#4caf50'}">${v.estado}</span></span>
      </div>
      <div style="display:flex; gap:5px;">
        <button class="btn-touch btn-secondary" style="padding: 8px; width:auto; font-size:12px;" onclick="abrirEdicion('${v.id}', '${v.nombre_cliente}', ${v.unidades}, '${v.estado}')">✏️ Editar</button>
        <button class="btn-touch btn-danger" style="margin:0; padding: 8px; width:auto; font-size:12px;" onclick="eliminarVenta('${v.id}')">🗑️ Borrar</button>
      </div>
    `;
    lista.appendChild(div);
  });
}

async function eliminarVenta(id) {
  if (!confirm('⚠️ ¿Seguro que deseas ELIMINAR esta venta permanentemente?')) return;
  
  const { error } = await supabaseClient.from('ventas').delete().eq('id', id);
  if (error) { 
    alert('❌ Error al eliminar: ' + error.message); 
    return; 
  }
  
  cargarAdmin(); cargarDashboard(); cargarInventario(); cargarReservas();
}

function abrirEdicion(id, nombre, unidades, estado) {
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-nombre').value = nombre;
  document.getElementById('edit-unidades').value = unidades;
  document.getElementById('edit-estado').value = estado;
  document.getElementById('edit-modal').classList.remove('hidden');
}

async function guardarEdicion() {
  const id = document.getElementById('edit-id').value;
  const nombre = document.getElementById('edit-nombre').value;
  const unidadesEdit = parseInt(document.getElementById('edit-unidades').value);
  const estadoEdit = document.getElementById('edit-estado').value;

  const { error } = await supabaseClient.from('ventas').update({ 
    nombre_cliente: nombre, 
    unidades: unidadesEdit, 
    estado: estadoEdit 
  }).eq('id', id);
  
  if (error) { 
    alert('❌ Error: ' + error.message); 
  } else { 
    alert('✅ Venta modificada correctamente'); 
    document.getElementById('edit-modal').classList.add('hidden');
    cargarAdmin(); cargarDashboard(); cargarInventario(); cargarReservas();
  }
}

async function limpiarDB() {
  if (!confirm('⚠️ PELIGRO: ¿Estás seguro de borrar TODA la base de datos? Esto no se puede deshacer.')) return;
  
  const palabra = prompt('Escribe "BORRAR" con mayúsculas para confirmar:');
  if (palabra !== 'BORRAR') { 
    alert('Operación cancelada'); 
    return; 
  }

  // Borrado masivo usando .not('id', 'is', null) que equivale a "borrar todo"
  await supabaseClient.from('entregas').delete().not('id', 'is', null);
  await supabaseClient.from('inventario').delete().not('id', 'is', null);
  await supabaseClient.from('ventas').delete().not('id', 'is', null);

  alert('🧹 Base de datos limpiada por completo.');
  cargarAdmin(); cargarDashboard(); cargarInventario(); cargarReservas();
}

// Agregar animación de confeti
const style = document.createElement('style');
style.textContent = `@keyframes confettiFall { to { transform: translateY(100vh) rotate(360deg); opacity: 0; } }`;
document.head.appendChild(style);