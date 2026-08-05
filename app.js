/* ═══════════════════ شجرة العائلة — المنطق ═══════════════════ */
'use strict';

const APP_VERSION = '١٧';

/* مصيدة أخطاء: أي خطأ برمجي يظهر إشعاراً مرئياً بدل الفشل الصامت */
let __errCount = 0;
window.addEventListener('error', e => {
  if (++__errCount > 3) return;
  const t = document.getElementById('toast');
  if (t) { t.textContent = '⚠️ خطأ برمجي: ' + (e.message || '؟') + ' — أبلغ حيدر به'; t.classList.add('on'); }
});
window.addEventListener('unhandledrejection', e => {
  if (++__errCount > 3) return;
  const t = document.getElementById('toast');
  if (t) { t.textContent = '⚠️ خطأ: ' + (e.reason?.message || e.reason || '؟'); t.classList.add('on'); }
});

/* ─────────── أدوات عامة ─────────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arD = n => String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

const DEMO = new URLSearchParams(location.search).has('demo');
const VIEW = new URLSearchParams(location.search).has('view');   // عرض عام للقراءة فقط

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(on) { $('#busy').classList.toggle('on', !!on); }

/* تحويل السنوات هجري ↔ ميلادي (تقريب سنوي معتمد) */
const h2g = h => Math.round(h * 0.970224 + 621.5643);
const g2h = g => Math.round((g - 621.5643) / 0.970224);
const NOW_G = new Date().getFullYear();

function yearsLabel(p) {
  const parts = [];
  if (p.byh) parts.push(`${arD(p.byh)}هـ / ${arD(p.byg)}م`);
  if (p.dead) parts.push(p.dyh ? `ت: ${arD(p.dyh)}هـ / ${arD(p.dyg)}م` : 'متوفى');
  return parts.join('<br>');
}

/* ─────────── حالة التطبيق ─────────── */
let SESSION = null;      // {uid, un, role, idToken, rt}
let PEOPLE = {};         // id → person
let META = null;         // {familyName, owner}
let SETUP_LOCKED = true;

/* شكل الشخص:
   {id, n, g:'m'|'f', byh, byg, dyh, dyg, dead, mar, ph, f, m, sp:[], root, ord, cb, ub, ct, ut} */

/* ─────────── ترميز/فك قيم Firestore ─────────── */
function fsEnc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) fields[k] = { nullValue: null };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (Array.isArray(v)) fields[k] = { arrayValue: { values: v.map(x => ({ stringValue: String(x) })) } };
    else fields[k] = { stringValue: String(v) };
  }
  return { fields };
}
function fsDec(doc) {
  const out = {};
  const f = doc.fields || {};
  for (const [k, v] of Object.entries(f)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = parseInt(v.integerValue, 10);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('nullValue' in v) out[k] = null;
    else if ('arrayValue' in v) out[k] = (v.arrayValue.values || []).map(x => x.stringValue);
  }
  out._doc = doc.name;
  if (doc.name) out.id = doc.name.split('/').pop();
  return out;
}

/* ─────────── طبقة الاتصال (Firestore + Auth REST) ─────────── */
const FS_BASE = () => `https://firestore.googleapis.com/v1/projects/${FT_CONFIG.PROJECT_ID}/databases/(default)/documents`;

async function fsReq(method, path, body, noAuth) {
  const url = `${FS_BASE()}${path}${path.includes('?') ? '&' : '?'}key=${FT_CONFIG.API_KEY}`;
  const headers = { 'Content-Type': 'application/json' };
  if (!noAuth && SESSION?.idToken) headers.Authorization = `Bearer ${SESSION.idToken}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    const err = new Error(msg); err.status = res.status;
    throw err;
  }
  return data;
}

async function authReq(endpoint, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FT_CONFIG.API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data?.error?.message || 'AUTH_ERROR'); err.code = data?.error?.message; throw err; }
  return data;
}

const AUTH_ERRS = {
  EMAIL_NOT_FOUND: 'اسم المستخدم غير موجود',
  INVALID_PASSWORD: 'كلمة المرور غير صحيحة',
  INVALID_LOGIN_CREDENTIALS: 'اسم المستخدم أو كلمة المرور غير صحيحة',
  EMAIL_EXISTS: 'اسم المستخدم محجوز مسبقاً',
  WEAK_PASSWORD: 'كلمة المرور ضعيفة — ٦ أحرف على الأقل',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة',
  OPERATION_NOT_ALLOWED: 'الدخول بالإيميل غير مفعّل في مشروع Firebase (راجع خطوات الإعداد)'
};
const authErrMsg = e => AUTH_ERRS[(e.code || '').split(' ')[0]] || `خطأ: ${e.message}`;

const unToEmail = un => `${un}@${FT_CONFIG.EMAIL_DOMAIN}`;
const UN_RE = /^[a-z0-9_.-]{3,20}$/;

/* ─────────── الوضع التجريبي (localStorage) ─────────── */
const DKEY = 'ft_demo_v2';
function demoLoad() {
  try { return JSON.parse(localStorage.getItem(DKEY)) || null; } catch { return null; }
}
function demoSave(d) { localStorage.setItem(DKEY, JSON.stringify(d)); }
function demoSeed() {
  const Y = (h) => ({ byh: h, byg: h2g(h) });
  const P = (id, n, g, extra) => Object.assign({ id, n, g, byh: 0, byg: 0, dyh: 0, dyg: 0, dead: false, mar: false, ph: '', f: '', m: '', sp: [], root: false, ord: 0, cb: 'تجربة', ub: '', ct: Date.now(), ut: 0 }, extra);
  const people = [
    P('p1', 'عبدالله الجد المؤسس', 'm', { root: true, mar: true, dead: true, ...Y(1330), dyh: 1410, dyg: h2g(1410), sp: ['p2'] }),
    P('p2', 'فاطمة أم العائلة', 'f', { mar: true, dead: true, ...Y(1338), dyh: 1418, dyg: h2g(1418), sp: ['p1'] }),
    P('p3', 'محمد', 'm', { f: 'p1', m: 'p2', mar: true, ...Y(1360), sp: ['p4', 'p15'], ord: 1 }),
    P('p4', 'زينب', 'f', { mar: true, ...Y(1365), sp: ['p3'] }),
    P('p5', 'علي', 'm', { f: 'p1', m: 'p2', mar: true, ...Y(1363), sp: ['p6'], ord: 2 }),
    P('p6', 'مريم', 'f', { mar: true, ...Y(1368), sp: ['p5'] }),
    P('p7', 'خديجة', 'f', { f: 'p1', m: 'p2', ...Y(1366), ord: 3 }),
    P('p8', 'حسين', 'm', { f: 'p3', m: 'p4', mar: true, ...Y(1385), sp: ['p9'], ord: 1 }),
    P('p9', 'سارة', 'f', { mar: true, ...Y(1390), sp: ['p8'] }),
    P('p10', 'أحمد', 'm', { f: 'p3', m: 'p4', ...Y(1390), ord: 2 }),
    P('p11', 'كاظم', 'm', { f: 'p5', m: 'p6', dead: true, ...Y(1388), dyh: 1440, dyg: h2g(1440), ord: 1 }),
    P('p12', 'ليلى', 'f', { f: 'p5', m: 'p6', ...Y(1392), ord: 2 }),
    P('p13', 'ياسين', 'm', { f: 'p8', m: 'p9', ...Y(1415), ord: 1 }),
    P('p14', 'نور', 'f', { f: 'p8', m: 'p9', ...Y(1418), ord: 2 }),
    P('p15', 'هند', 'f', { mar: true, ...Y(1370), sp: ['p3'] }),
    P('p16', 'عباس', 'm', { f: 'p3', m: 'p15', ...Y(1395), ord: 3 }),
  ];
  const d = { people: {}, log: [], meta: { familyName: 'عائلة التجربة', owner: 'demo' } };
  people.forEach(p => d.people[p.id] = p);
  demoSave(d);
  return d;
}

/* ─────────── واجهة البيانات الموحدة ─────────── */
const DB = {
  async loadMeta() {
    if (DEMO) { const d = demoLoad() || demoSeed(); META = d.meta; SETUP_LOCKED = true; return; }
    try {
      const doc = await fsReq('GET', '/ft_meta/setup', null, true);
      META = fsDec(doc); SETUP_LOCKED = true;
    } catch (e) {
      if (e.status === 404) { META = null; SETUP_LOCKED = false; }
      else throw e;
    }
  },
  async loadPeople() {
    if (DEMO) { PEOPLE = structuredClone((demoLoad() || demoSeed()).people); return; }
    PEOPLE = {};
    let pageToken = '';
    do {
      const data = await fsReq('GET', `/ft_people?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`);
      (data.documents || []).forEach(doc => { const p = fsDec(doc); p.sp = p.sp || []; PEOPLE[p.id] = p; });
      pageToken = data.nextPageToken || '';
    } while (pageToken);
  },
  async savePerson(p, isNew) {
    const rec = { ...p }; delete rec.id; delete rec._doc;
    if (DEMO) {
      const d = demoLoad(); d.people[p.id] = structuredClone(p); demoSave(d); return;
    }
    if (isNew) await fsReq('POST', `/ft_people?documentId=${p.id}`, fsEnc(rec));
    else await fsReq('PATCH', `/ft_people/${p.id}`, fsEnc(rec));
  },
  async deletePerson(id) {
    if (DEMO) { const d = demoLoad(); delete d.people[id]; demoSave(d); return; }
    await fsReq('DELETE', `/ft_people/${id}`);
  },
  async addLog(action, pname, details) {
    const rec = { u: SESSION?.un || '؟', a: action, p: pname || '', d: details || '', ts: Date.now() };
    if (DEMO) { const d = demoLoad(); d.log.unshift(rec); d.log = d.log.slice(0, 500); demoSave(d); return; }
    try { await fsReq('POST', '/ft_log', fsEnc(rec)); } catch (e) { console.warn('log failed', e); }
  },
  async listLog() {
    if (DEMO) return (demoLoad()?.log) || [];
    const out = [];
    let pageToken = '';
    do {
      const data = await fsReq('GET', `/ft_log?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`);
      (data.documents || []).forEach(doc => out.push(fsDec(doc)));
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out.sort((a, b) => b.ts - a.ts);
  },
  async listUsers() {
    if (DEMO) return [{ id: 'demo', un: 'تجربة', role: 'owner', ct: Date.now() }];
    const data = await fsReq('GET', '/ft_users?pageSize=100');
    return (data.documents || []).map(fsDec);
  },
  async addComment(name, text, tag) {
    const rec = { n: name, t: text, ts: Date.now() };
    if (tag) { rec.pid = tag.id; rec.pn = tag.name; }
    if (DEMO) { const d = demoLoad(); (d.comments = d.comments || []).unshift(rec); demoSave(d); return; }
    await fsReq('POST', '/ft_comments', fsEnc(rec), !SESSION);
  },
  async listComments() {
    if (DEMO) return (demoLoad()?.comments) || [];
    const out = [];
    let pageToken = '';
    do {
      const data = await fsReq('GET', `/ft_comments?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`);
      (data.documents || []).forEach(doc => out.push(fsDec(doc)));
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out.sort((a, b) => b.ts - a.ts);
  },
  async deleteComment(id) {
    if (DEMO) return;
    await fsReq('DELETE', `/ft_comments/${id}`);
  }
};

/* ─────────── الجلسة ─────────── */
const SKEY = 'ft_session_v1';
function sessionSave() { if (!DEMO && SESSION) localStorage.setItem(SKEY, JSON.stringify({ rt: SESSION.rt, uid: SESSION.uid, un: SESSION.un })); }
function sessionClear() { localStorage.removeItem(SKEY); SESSION = null; }

async function refreshIdToken(rt) {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FT_CONFIG.API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'REFRESH_FAILED');
  return { idToken: data.id_token, rt: data.refresh_token, uid: data.user_id };
}

async function loadRole() {
  const doc = await fsReq('GET', `/ft_users/${SESSION.uid}`);
  const u = fsDec(doc);
  SESSION.role = u.role; SESSION.un = u.un;
}

async function tryResume() {
  if (DEMO) {
    SESSION = { uid: 'demo', un: 'تجربة', role: 'owner', idToken: '', rt: '' };
    return true;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SKEY)); } catch {}
  if (!saved?.rt) return false;
  try {
    const t = await refreshIdToken(saved.rt);
    SESSION = { uid: t.uid, un: saved.un, idToken: t.idToken, rt: t.rt, role: '' };
    await loadRole();
    sessionSave();
    return true;
  } catch (e) {
    console.warn('resume failed', e);
    sessionClear();
    return false;
  }
}

/* تجديد التوكن دورياً (صلاحيته ساعة) */
setInterval(async () => {
  if (SESSION?.rt) {
    try { const t = await refreshIdToken(SESSION.rt); SESSION.idToken = t.idToken; SESSION.rt = t.rt; sessionSave(); } catch {}
  }
}, 45 * 60 * 1000);

/* ─────────── الدخول والإعداد الأول ─────────── */
async function doLogin(un, pw) {
  const data = await authReq('signInWithPassword', { email: unToEmail(un), password: pw, returnSecureToken: true });
  SESSION = { uid: data.localId, un, idToken: data.idToken, rt: data.refreshToken, role: '' };
  try { await loadRole(); }
  catch (e) {
    sessionClear();
    throw new Error('هذا الحساب غير مفعّل في الشجرة — راجع الأدمن الأكبر');
  }
  sessionSave();
}

async function doSetup(familyName, un, pw) {
  const data = await authReq('signUp', { email: unToEmail(un), password: pw, returnSecureToken: true });
  SESSION = { uid: data.localId, un, idToken: data.idToken, rt: data.refreshToken, role: 'owner' };
  await fsReq('PATCH', `/ft_users/${SESSION.uid}`, fsEnc({ un, role: 'owner', ct: Date.now() }));
  await fsReq('PATCH', '/ft_meta/setup', fsEnc({ familyName, owner: SESSION.uid, ct: Date.now() }));
  META = { familyName, owner: SESSION.uid };
  SETUP_LOCKED = true;
  sessionSave();
}

/* ─────────── مساعدات القرابة والنسب ─────────── */
const bloodline = p => !!(p.root || (p.f && PEOPLE[p.f]));

function childrenOf(p) {
  return Object.values(PEOPLE).filter(c => {
    if (c.f === p.id) return true;
    if (c.m === p.id) {
      const fa = c.f && PEOPLE[c.f];
      return !(fa && bloodline(fa)); // يُعرض تحت الأب إن كان من صلب العائلة
    }
    return false;
  }).sort((a, b) => (a.ord || 99) - (b.ord || 99) || (a.byg || 9999) - (b.byg || 9999) || a.n.localeCompare(b.n, 'ar'));
}

/* ─────────── رسم الشجرة ─────────── */
function cardHTML(p, { main = true } = {}) {
  const cls = bloodline(p) ? (p.g === 'm' ? 'male' : 'female') : 'inlaw';
  const av = p.ph ? `<div class="avatar"><img src="${esc(p.ph)}" alt=""></div>` : '';
  return `<div class="pcard ${cls}${p.dead ? ' dead' : ''}${p.ph ? ' hasph' : ''}" data-id="${esc(p.id)}" ${main ? 'data-main="1"' : ''}>
    ${av}
    <div class="pname">${esc(p.n)}</div>
    <div class="pyears">${yearsLabel(p)}</div>
  </div>`;
}

/* الزوج/الزوجة: رقاقة صغيرة لاصقة تحت بطاقة القرين — الضغط يفتح بطاقته */
function spouseChipHTML(s) {
  const main = !bloodline(s); // إن لم يكن من الصلب فالرقاقة تمثيله الرئيس (للبحث)
  return `<div class="wchip${s.dead ? ' dead' : ''}" data-id="${esc(s.id)}" ${main ? 'data-main="1"' : ''}>⚭ ${esc(s.n)}${s.dead ? ' (ت)' : ''}</div>`;
}

function nodeHTML(p, isRoot) {
  const spouses = (p.sp || []).map(id => PEOPLE[id]).filter(Boolean);
  const kids = childrenOf(p);

  /* تعدد الزوجات (أو الأزواج): كل زوجة رقاقةٌ رأسُ فرعٍ تحته أبناؤها */
  if (spouses.length >= 2) {
    const byMate = new Map(spouses.map(s => [s.id, []]));
    const rest = [];
    for (const k of kids) {
      const key = byMate.has(k.m) ? k.m : (byMate.has(k.f) ? k.f : null);
      if (key) byMate.get(key).push(k); else rest.push(k);
    }
    const mateBranches = spouses.map(s => {
      const sk = byMate.get(s.id);
      const skHTML = sk.length ? `<div class="kids">${sk.map(k => nodeHTML(k, false)).join('')}</div>` : '';
      return `<div class="branch mate"><div class="punit">${spouseChipHTML(s)}</div>${skHTML}</div>`;
    }).join('');
    const restHTML = rest.map(k => nodeHTML(k, false)).join('');
    return `<div class="branch${isRoot ? ' root' : ''}"><div class="punit">${cardHTML(p)}</div>
      <div class="kids">${mateBranches}${restHTML}</div></div>`;
  }

  /* زوجة واحدة أو بلا زواج: البطاقة والرقاقة تحتها والأبناء أسفلهما */
  const unit = `<div class="punit">${cardHTML(p)}${spouses.map(spouseChipHTML).join('')}</div>`;
  const kidsHTML = kids.length ? `<div class="kids">${kids.map(k => nodeHTML(k, false)).join('')}</div>` : '';
  return `<div class="branch${isRoot ? ' root' : ''}">${unit}${kidsHTML}</div>`;
}

function treeHTML(roots) {
  return `<div class="tree-root">${roots.map(r => nodeHTML(r, true)).join('')}</div>`;
}

function renderTree() {
  const roots = Object.values(PEOPLE).filter(p => p.root)
    .sort((a, b) => (a.ord || 99) - (b.ord || 99) || (a.byg || 9999) - (b.byg || 9999));
  const canvas = $('#canvas');
  const empty = $('#emptyMsg');
  if (!roots.length) {
    canvas.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  canvas.innerHTML = treeHTML(roots);
  canvas.querySelectorAll('.pcard, .wchip').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (RELMODE) { pickRelPerson(el.dataset.id); return; }
      openPersonView(el.dataset.id);
    });
  });
  requestAnimationFrame(fitView);
}

/* ─────────── تحريك وتكبير ─────────── */
let VS = { scale: 1, tx: 0, ty: 0 };
function applyView() {
  $('#canvas').style.transform = `translate(${VS.tx}px, ${VS.ty}px) scale(${VS.scale})`;
}
function fitView() {
  const vp = $('#viewport'), c = $('#canvas');
  const w = c.scrollWidth, h = c.scrollHeight;
  if (!w) return;
  const s = Math.min(vp.clientWidth / w, vp.clientHeight / h, 1);
  VS.scale = Math.max(s, 0.08);
  VS.tx = (vp.clientWidth - w * VS.scale) / 2;
  VS.ty = Math.max((vp.clientHeight - h * VS.scale) / 2, 8);
  applyView();
}
function zoomAt(factor, cx, cy) {
  const ns = Math.min(Math.max(VS.scale * factor, 0.08), 2.5);
  const k = ns / VS.scale;
  VS.tx = cx - (cx - VS.tx) * k;
  VS.ty = cy - (cy - VS.ty) * k;
  VS.scale = ns;
  applyView();
}
function centerOnEl(el) {
  const vp = $('#viewport');
  const cr = $('#canvas').getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const ex = (er.left + er.width / 2 - cr.left) / VS.scale;
  const ey = (er.top + er.height / 2 - cr.top) / VS.scale;
  VS.tx = vp.clientWidth / 2 - ex * VS.scale;
  VS.ty = vp.clientHeight / 2 - ey * VS.scale;
  applyView();
}

function initViewport() {
  const vp = $('#viewport');
  const pointers = new Map();
  let lastPinch = 0;

  vp.addEventListener('pointerdown', e => {
    // لا تلتقط المؤشر فوق البطاقات أو الأزرار — وإلا ابتُلعت نقراتها
    if (e.target.closest('.pcard, button, .zoombar, .legend, input, select, a')) return;
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vp.classList.add('grabbing');
  });
  vp.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const pts = [...pointers.values()];
    if (pointers.size === 2) {
      const ids = [...pointers.keys()];
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a = pointers.get(ids[0]), b = pointers.get(ids[1]);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch) zoomAt(dist / lastPinch, (a.x + b.x) / 2, (a.y + b.y) / 2 - vp.getBoundingClientRect().top);
      lastPinch = dist;
    } else {
      const prev = pointers.get(e.pointerId);
      VS.tx += e.clientX - prev.x;
      VS.ty += e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      applyView();
    }
  });
  const up = e => { pointers.delete(e.pointerId); lastPinch = 0; if (!pointers.size) vp.classList.remove('grabbing'); };
  vp.addEventListener('pointerup', up);
  vp.addEventListener('pointercancel', up);
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.9, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  $('#zin').onclick = () => zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2);
  $('#zout').onclick = () => zoomAt(0.83, vp.clientWidth / 2, vp.clientHeight / 2);
  $('#zfit').onclick = fitView;
}

/* ─────────── البحث ─────────── */
function doSearch(q) {
  $$('#canvas .pcard, #canvas .wchip').forEach(el => el.classList.remove('hit'));
  q = q.trim();
  if (!q) return;
  const hits = $$('#canvas [data-main]').filter(el => (PEOPLE[el.dataset.id]?.n || '').includes(q));
  hits.forEach(el => el.classList.add('hit'));
  if (hits.length) centerOnEl(hits[0]);
  else toast('لا نتائج');
}

/* ─────────── نوافذ عامة ─────────── */
function openModal(id) { $(id).classList.add('on'); }
function closeModal(id) { $(id).classList.remove('on'); }
$$('.overlay').length; // noop

/* ─────────── نموذج إضافة/تعديل شخص ─────────── */
let FORM = null; // {editId, cal, dcal, photo, spList}

function fatherOptions(selected, excludeId) {
  const males = Object.values(PEOPLE).filter(p => p.g === 'm' && p.id !== excludeId)
    .sort((a, b) => a.n.localeCompare(b.n, 'ar'));
  return `<option value="__root__">— مؤسس الشجرة (أعلى الشجرة) —</option>
          <option value="">— بدون أب (زوج/زوجة من خارج العائلة) —</option>` +
    males.map(p => `<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${esc(p.n)}</option>`).join('');
}
function motherOptions(selected, excludeId, fatherId) {
  const opt = p => `<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${esc(p.n)}</option>`;
  const females = Object.values(PEOPLE).filter(p => p.g === 'f' && p.id !== excludeId)
    .sort((a, b) => a.n.localeCompare(b.n, 'ar'));
  const father = fatherId && fatherId !== '__root__' ? PEOPLE[fatherId] : null;
  const wives = father ? (father.sp || []).map(id => PEOPLE[id]).filter(x => x && x.g === 'f' && x.id !== excludeId) : [];
  const wifeIds = new Set(wives.map(w => w.id));
  const rest = females.filter(f => !wifeIds.has(f.id));
  let html = `<option value="">— غير محددة —</option>`;
  if (wives.length) html += `<optgroup label="زوجات الأب المختار">${wives.map(opt).join('')}</optgroup>`;
  html += wives.length ? `<optgroup label="أخريات">${rest.map(opt).join('')}</optgroup>` : rest.map(opt).join('');
  return html;
}

function openPersonForm(editId, presetFatherId) {
  const p = editId ? PEOPLE[editId] : null;
  FORM = {
    editId: editId || null,
    cal: 'h', dcal: 'h',
    photo: p?.ph || '',
    spList: p ? [...(p.sp || [])] : [],
    newSpouses: []
  };
  $('#pfSpouseName').value = '';
  $('#pfTitle').textContent = p ? `تعديل: ${p.n}` : 'إضافة فرد جديد';
  $('#pfName').value = p?.n || '';
  setSeg('#pfGender', p?.g || 'm');
  $('#pfFather').innerHTML = fatherOptions(p ? (p.root ? '__root__' : p.f) : (presetFatherId || ''), editId);
  if (!p && !presetFatherId) $('#pfFather').value = Object.values(PEOPLE).some(x => x.root) ? '' : '__root__';
  $('#pfMother').innerHTML = motherOptions(p?.m || '', editId, $('#pfFather').value);
  setSeg('#pfCal', 'h');
  $('#pfBirth').value = p?.byh || '';
  $('#pfBirthHint').textContent = '';
  $('#pfMar').checked = !!p?.mar || FORM.spList.length > 0;
  $('#pfDead').checked = !!p?.dead;
  setSeg('#pfDCal', 'h');
  $('#pfDeath').value = p?.dyh || '';
  $('#pfDeathHint').textContent = '';
  $('#pfOrd').value = p?.ord || '';
  updateOrdHint();
  renderPhotoPrev();
  renderSpouseChips();
  toggleSub();
  $('#pfErr').textContent = '';
  closeModal('#mdView');
  openModal('#mdForm');
  setTimeout(() => $('#pfName').focus(), 50);
}

function setSeg(sel, val) {
  $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === val));
  $(sel).dataset.value = val;
}
function getSeg(sel) { return $(sel).dataset.value; }

function toggleSub() {
  $('#pfSpousePanel').style.display = $('#pfMar').checked ? '' : 'none';
  $('#pfDeathPanel').style.display = $('#pfDead').checked ? '' : 'none';
}

function renderPhotoPrev() {
  $('#pfPhotoPrev').innerHTML = FORM.photo ? `<img src="${esc(FORM.photo)}">` : '📷';
  $('#pfPhotoDel').style.display = FORM.photo ? '' : 'none';
}

function renderSpouseChips() {
  const g = getSeg('#pfGender');
  $('#spLabel').textContent = g === 'm' ? 'زوجاته' : 'زوجها';
  $('#pfSpouseName').placeholder = g === 'm' ? 'اكتب اسم الزوجة هنا…' : 'اكتب اسم الزوج هنا…';
  $('#pfSpouseAddBtn').textContent = g === 'm' ? '＋ أضف الزوجة' : '＋ أضف الزوج';
  const chips = [];
  for (const id of FORM.spList) {
    const s = PEOPLE[id];
    chips.push(`<span class="spchip">⚭ ${esc(s?.n || id)} <a data-rmsp="${id}">✕</a></span>`);
  }
  FORM.newSpouses.forEach((nm, i) => {
    chips.push(`<span class="spchip new">⚭ ${esc(nm)} <small>جديد${g === 'm' ? 'ة' : ''}</small> <a data-rmnew="${i}">✕</a></span>`);
  });
  const wrap = $('#pfSpouses');
  wrap.innerHTML = chips.join('') || `<span class="hint">${g === 'm' ? 'لم تُسجَّل زوجة بعد' : 'لم يُسجَّل زوج بعد'}</span>`;
  wrap.querySelectorAll('[data-rmsp]').forEach(a => a.onclick = () => {
    FORM.spList = FORM.spList.filter(x => x !== a.dataset.rmsp);
    renderSpouseChips();
  });
  wrap.querySelectorAll('[data-rmnew]').forEach(a => a.onclick = () => {
    FORM.newSpouses.splice(+a.dataset.rmnew, 1);
    renderSpouseChips();
  });
  renderSpouseSugg();
}
/* اقتراحات حية: إن كان الاسم المكتوب موجوداً في الشجرة يظهر زر ربط فوري */
function renderSpouseSugg() {
  const q = $('#pfSpouseName').value.trim();
  const box = $('#pfSpouseSugg');
  if (!q) { box.innerHTML = ''; return; }
  const g = getSeg('#pfGender');
  const cands = Object.values(PEOPLE).filter(x =>
    x.id !== FORM.editId && x.g !== g && !FORM.spList.includes(x.id) && x.n.includes(q)
  ).slice(0, 6);
  box.innerHTML = cands.length
    ? `<div class="hint" style="margin-top:6px">${g === 'm' ? 'موجودة في الشجرة؟' : 'موجود في الشجرة؟'} اضغط الاسم للربط بدل إنشاء جديد:</div>` +
      cands.map(c => `<button type="button" class="btn btn-sm" data-lnk="${c.id}" style="margin:3px">🔗 ${esc(c.n)}</button>`).join('')
    : '';
  box.querySelectorAll('[data-lnk]').forEach(b => b.onclick = () => {
    FORM.spList.push(b.dataset.lnk);
    $('#pfSpouseName').value = '';
    $('#pfMar').checked = true;
    renderSpouseChips();
  });
}
function addSpouseFromInput() {
  const nm = $('#pfSpouseName').value.trim();
  if (!nm) { toast('اكتب الاسم أولاً'); return; }
  FORM.newSpouses.push(nm);
  $('#pfSpouseName').value = '';
  $('#pfMar').checked = true;
  renderSpouseChips();
}

async function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const M = 200;
        const k = Math.min(M / img.width, M / img.height, 1);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = rd.result;
    };
    rd.onerror = reject;
    rd.readAsDataURL(file);
  });
}

function yearPair(val, cal) {
  const y = parseInt(val, 10);
  if (!y) return { h: 0, g: 0 };
  return cal === 'h' ? { h: y, g: h2g(y) } : { h: g2h(y), g: y };
}

async function submitPersonForm() {
  const name = $('#pfName').value.trim();
  if (!name) { $('#pfErr').textContent = 'الاسم مطلوب'; return; }
  const g = getSeg('#pfGender');
  const fSel = $('#pfFather').value;
  const root = fSel === '__root__';
  const f = root ? '' : fSel;
  const m = $('#pfMother').value;
  const b = yearPair($('#pfBirth').value, getSeg('#pfCal'));
  const dead = $('#pfDead').checked;
  const d = dead ? yearPair($('#pfDeath').value, getSeg('#pfDCal')) : { h: 0, g: 0 };
  const mar = $('#pfMar').checked;

  const isNew = !FORM.editId;
  const id = FORM.editId || ('p_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
  const old = FORM.editId ? PEOPLE[FORM.editId] : null;

  const p = {
    id, n: name, g,
    byh: b.h, byg: b.g, dyh: d.h, dyg: d.g,
    dead, mar: mar || FORM.spList.length > 0 || FORM.newSpouses.length > 0,
    ph: FORM.photo || '',
    f, m: m || '', sp: [...FORM.spList],
    root, ord: parseInt($('#pfOrd').value, 10) || 0,
    cb: old?.cb || SESSION.un, ub: SESSION.un,
    ct: old?.ct || Date.now(), ut: Date.now()
  };

  busy(true);
  try {
    const parentKey = p.f ? 'f' : (p.m ? 'm' : '');
    const sibs = parentKey ? Object.values(PEOPLE).filter(c => c[parentKey] === p[parentKey] && c.id !== p.id) : [];
    // ترتيب تلقائي: إن تُرك الحقل فارغاً وسنة الميلاد معروفة، يُحسب موضعه تصاعدياً بين إخوته
    if (!p.ord && p.byg > 0 && parentKey) {
      p.ord = sibs.filter(s => s.byg > 0 && s.byg <= p.byg).length + 1;
    }
    // إدراج بالترتيب: إن كان الرقم محجوزاً عند أخٍ تزحزحَ هو ومن بعده رقماً واحداً
    if (p.ord > 0 && parentKey && sibs.some(s => s.ord === p.ord)) {
      for (const s of sibs.filter(s => s.ord >= p.ord)) {
        s.ord += 1; s.ub = SESSION.un; s.ut = Date.now();
        await DB.savePerson(s, false);
      }
    }
    // إنشاء الأزواج الجدد المكتوبين بالاسم (من خارج العائلة)
    for (const nm of FORM.newSpouses) {
      const sid = 'p_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      const spObj = {
        id: sid, n: nm, g: g === 'm' ? 'f' : 'm',
        byh: 0, byg: 0, dyh: 0, dyg: 0, dead: false, mar: true,
        ph: '', f: '', m: '', sp: [id], root: false, ord: 0,
        cb: SESSION.un, ub: '', ct: Date.now(), ut: 0
      };
      await DB.savePerson(spObj, true);
      PEOPLE[sid] = spObj;
      p.sp.push(sid);
      await DB.addLog('add', nm, `زوج${g === 'm' ? 'ة' : ''} «${name}» — من خارج العائلة`);
    }
    FORM.newSpouses = [];
    await DB.savePerson(p, isNew);
    PEOPLE[id] = p;
    // مزامنة روابط الأزواج في الاتجاهين
    const oldSp = old?.sp || [];
    for (const sid of p.sp.filter(x => !oldSp.includes(x))) {
      const s = PEOPLE[sid];
      if (s && !s.sp.includes(id)) { s.sp.push(id); s.mar = true; s.ub = SESSION.un; s.ut = Date.now(); await DB.savePerson(s, false); }
    }
    for (const sid of oldSp.filter(x => !p.sp.includes(x))) {
      const s = PEOPLE[sid];
      if (s && s.sp.includes(id)) { s.sp = s.sp.filter(x => x !== id); s.ub = SESSION.un; s.ut = Date.now(); await DB.savePerson(s, false); }
    }
    // ربط الوالد الجديد بابنه القائم (البناء لأعلى)
    if (FORM.adopt) {
      const child = PEOPLE[FORM.adopt.childId];
      if (child) {
        if (FORM.adopt.as === 'f') { child.f = id; if (child.root) child.root = false; }
        else child.m = id;
        child.ub = SESSION.un; child.ut = Date.now();
        await DB.savePerson(child, false);
        // إن كان للابن والدٌ آخر معروف: اربط الوالدين زوجين تلقائياً
        const otherId = FORM.adopt.as === 'f' ? child.m : child.f;
        const other = otherId && PEOPLE[otherId];
        if (other && !p.sp.includes(otherId)) {
          p.sp.push(otherId); p.mar = true;
          await DB.savePerson(p, false);
          if (!other.sp.includes(id)) { other.sp.push(id); other.mar = true; other.ub = SESSION.un; other.ut = Date.now(); await DB.savePerson(other, false); }
        }
        await DB.addLog('edit', child.n, FORM.adopt.as === 'f' ? `ربطه بوالده الجديد «${name}»` : `ربطه بوالدته الجديدة «${name}»`);
      }
    }
    await DB.addLog(isNew ? 'add' : 'edit', name, isNew ? 'إضافة فرد' : 'تعديل بيانات');
    closeModal('#mdForm');
    renderTree();
    toast(isNew ? `أُضيف «${name}» للشجرة ✓` : `عُدّلت بيانات «${name}» ✓`);
  } catch (e) {
    $('#pfErr').textContent = 'تعذّر الحفظ: ' + e.message;
  } finally { busy(false); }
}

/* أعضاء الفرع: الشخص + أزواجه من خارج الصلب + ذريته كلها بأزواجها */
function branchMembers(p) {
  const ids = new Set();
  const walk = x => {
    if (!x || ids.has(x.id)) return;
    ids.add(x.id);
    (x.sp || []).map(sid => PEOPLE[sid]).filter(Boolean).forEach(s => {
      if (!bloodline(s)) ids.add(s.id); // زوج من الصلب يبقى في مكانه من الشجرة
    });
    Object.values(PEOPLE).filter(c => c.f === x.id || c.m === x.id).forEach(walk);
  };
  walk(p);
  return [...ids];
}

async function deletePerson(id) {
  const p = PEOPLE[id];
  if (!p) return;
  if (SESSION.role !== 'owner') { toast('الحذف للأدمن الأكبر فقط'); return; }
  const members = branchMembers(p);
  if (members.length === 1) {
    if (!confirm(`حذف «${p.n}» نهائياً من الشجرة؟`)) return;
  } else {
    const names = members.map(x => PEOPLE[x]?.n).filter(Boolean);
    const preview = names.slice(0, 8).join('، ') + (names.length > 8 ? `، … (${arD(names.length - 8)} آخرين)` : '');
    if (!confirm(`سيُحذف «${p.n}» ومعه فرعه كاملاً — ${arD(members.length)} فرداً:\n${preview}\n\n(الزوجات والأبناء والأحفاد وأزواجهم من خارج العائلة)`)) return;
    if (!confirm(`تأكيد أخير: حذف ${arD(members.length)} فرداً نهائياً؟ لا يمكن التراجع.`)) return;
  }
  busy(true);
  try {
    const delSet = new Set(members);
    for (const mid of members) {
      await DB.deletePerson(mid);
    }
    // تنظيف روابط الزوجية عند الباقين
    for (const s of Object.values(PEOPLE)) {
      if (delSet.has(s.id)) continue;
      if ((s.sp || []).some(x => delSet.has(x))) {
        s.sp = s.sp.filter(x => !delSet.has(x));
        s.ub = SESSION.un; s.ut = Date.now();
        await DB.savePerson(s, false);
      }
    }
    members.forEach(mid => delete PEOPLE[mid]);
    await DB.addLog('del', p.n, members.length === 1 ? 'حذف من الشجرة' : `حذف فرعه كاملاً (${arD(members.length)} فرداً)`);
    closeModal('#mdView');
    renderTree();
    toast(members.length === 1 ? `حُذف «${p.n}»` : `حُذف فرع «${p.n}» كاملاً (${arD(members.length)} فرداً)`);
  } catch (e) { toast('تعذّر الحذف: ' + e.message); }
  finally { busy(false); }
}

/* ─────────── بطاقة عرض الشخص ─────────── */
function openPersonView(id) {
  const p = PEOPLE[id];
  if (!p) return;
  const cls = bloodline(p) ? (p.g === 'm' ? 'male' : 'female') : 'inlaw';
  const father = p.f && PEOPLE[p.f];
  const mother = p.m && PEOPLE[p.m];
  const spouses = (p.sp || []).map(x => PEOPLE[x]).filter(Boolean);
  const kids = Object.values(PEOPLE).filter(c => c.f === id || c.m === id)
    .sort((a, b) => (a.ord || 99) - (b.ord || 99));
  const age = p.byg ? (p.dead ? (p.dyg ? p.dyg - p.byg : null) : NOW_G - p.byg) : null;

  const rows = [];
  rows.push(['النوع', p.g === 'm' ? 'ذكر' : 'أنثى']);
  rows.push(['الحالة', p.mar ? 'متزوج' + (p.g === 'f' ? 'ة' : '') : 'أعزب' + (p.g === 'f' ? 'ة' : '')]);
  if (p.byh) rows.push(['الميلاد', `${arD(p.byh)}هـ — ${arD(p.byg)}م`]);
  if (p.dead && p.dyh) rows.push(['الوفاة', `${arD(p.dyh)}هـ — ${arD(p.dyg)}م`]);
  if (age !== null) rows.push([p.dead ? 'العمر عند الوفاة' : 'العمر', `${arD(age)} سنة تقريباً`]);
  if (father) rows.push(['الأب', linkName(father)]);
  if (mother) rows.push(['الأم', linkName(mother)]);
  if (spouses.length) rows.push([p.g === 'm' ? 'الزوجات' : 'الزوج', spouses.map(linkName).join('، ')]);
  if (kids.length) rows.push(['الأبناء', kids.map(linkName).join('، ')]);
  if (!bloodline(p)) rows.push(['الصفة', 'من خارج صلب العائلة (نسب)']);
  if (p.root) rows.push(['الصفة', 'مؤسس الشجرة']);

  $('#pvBody').innerHTML = `
    <div class="pv-head">
      <div class="pcard ${cls}" style="width:auto;padding:0;border:none;box-shadow:none;background:none;cursor:default">
        <div class="avatar">${p.ph ? `<img src="${esc(p.ph)}">` : esc(p.n.trim()[0])}</div>
      </div>
      <div>
        <div class="pv-name" style="${fullNasab(p).length > 34 ? 'font-size:19px;line-height:1.5' : ''}">${esc(fullNasab(p))}${p.dead ? '<span class="deadband">متوفى</span>' : ''}</div>
        <div class="pv-sub">${yearsLabel(p).replace('<br>', ' • ')}</div>
      </div>
    </div>
    <dl class="pv-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${VIEW ? '' : `<div class="pv-audit">أضافه: <b>${esc(p.cb || '—')}</b>${p.ub ? ` • آخر تعديل: <b>${esc(p.ub)}</b>` : ''}${p.ut ? ` (${fmtDate(p.ut)})` : ''}</div>`}
  `;
  $('#pvBody').querySelectorAll('[data-goto]').forEach(a => a.onclick = () => openPersonView(a.dataset.goto));

  $('#pvEdit').onclick = () => openPersonForm(id);
  $('#pvAddChild').onclick = () => {
    closeModal('#mdView');
    openPersonForm(null, p.g === 'm' ? id : (p.sp?.[0] && PEOPLE[p.sp[0]]?.g === 'm' ? p.sp[0] : ''));
    if (p.g === 'f') $('#pfMother').value = id;
  };
  // في العرض العام: أزرار المشاهدة فقط
  $('#pvEdit').style.display = VIEW ? 'none' : '';
  $('#pvAddChild').style.display = VIEW ? 'none' : '';
  $('#pvDelete').style.display = (!VIEW && SESSION?.role === 'owner') ? '' : 'none';
  $('#pvDelete').onclick = () => deletePerson(id);
  $('#pvRel').onclick = () => { closeModal('#mdView'); startRelMode(id); };
  $('#pvPdf').onclick = () => { closeModal('#mdView'); doExport(id); };
  // للزائر: اقتراح مربوط بهذا الفرد
  const sgBtn = $('#pvSuggest');
  sgBtn.style.display = VIEW ? '' : 'none';
  sgBtn.onclick = () => {
    closeModal('#mdView');
    CMT_TAG = { id: p.id, name: p.n };
    renderCmtTag();
    $('#cmErr').textContent = '';
    openModal('#mdComment');
    setTimeout(() => $('#cmName').focus(), 50);
  };
  // إضافة عائلته كاملة (زوجة + أبناء) والأب معبأ مسبقاً
  const famBtn = $('#pvAddFamily');
  famBtn.style.display = VIEW ? 'none' : '';
  famBtn.textContent = p.g === 'f' ? '⚡ إضافة عائلتها' : '⚡ إضافة عائلته';
  famBtn.onclick = () => {
    closeModal('#mdView');
    if (p.g === 'm') {
      openBulkModal(id);
    } else {
      const husband = (p.sp || []).map(x => PEOPLE[x]).find(x => x?.g === 'm');
      openBulkModal(husband?.id || '__inlaw__');
      BULK.wifeId = id;
      $('#bkWife').value = p.n;
      $('#bkWifeSugg').innerHTML = `<span class="hint">✓ «${esc(p.n)}» مثبتة زوجةً وأماً للأبناء أدناه</span>`;
    }
  };
  // إضافة زوجة مباشرة من البطاقة
  const spBtn = $('#pvAddSpouse');
  spBtn.style.display = VIEW ? 'none' : '';
  spBtn.textContent = p.g === 'm' ? '⚭ إضافة زوجة' : '⚭ إضافة زوج';
  spBtn.onclick = () => {
    openPersonForm(id);
    $('#pfMar').checked = true;
    toggleSub();
    setTimeout(() => $('#pfSpouseName').focus(), 80);
  };
  // البناء لأعلى: إضافة والدٍ أو والدة لمن لا والد له في الشجرة
  const fBtn = $('#pvAddFather'), mBtn = $('#pvAddMother');
  fBtn.style.display = (!VIEW && !father) ? '' : 'none';
  fBtn.textContent = p.g === 'f' ? '⬆ إضافة أبيها' : '⬆ إضافة أبيه';
  fBtn.onclick = () => { closeModal('#mdView'); openAddParent(id, 'f'); };
  mBtn.style.display = (!VIEW && !mother) ? '' : 'none';
  mBtn.textContent = p.g === 'f' ? '⬆ إضافة أمها' : '⬆ إضافة أمه';
  mBtn.onclick = () => { closeModal('#mdView'); openAddParent(id, 'm'); };
  openModal('#mdView');
}

/* إضافة والد/والدة فوق شخص قائم — الأب فوق مؤسسٍ يصبح المؤسس الجديد */
function openAddParent(childId, as) {
  const child = PEOPLE[childId];
  if (!child) return;
  openPersonForm(null);
  FORM.adopt = { childId, as };
  $('#pfTitle').textContent = (as === 'f' ? 'إضافة والد «' : 'إضافة والدة «') + child.n + '»';
  setSeg('#pfGender', as === 'f' ? 'm' : 'f');
  $('#pfFather').value = (as === 'f' && child.root) ? '__root__' : '';
  $('#pfMar').checked = true;
  toggleSub();
  renderSpouseChips();
}
const linkName = p => `<a data-goto="${p.id}" style="color:var(--gold);cursor:pointer;font-weight:700">${esc(p.n)}</a>`;

/* هل يتصل نسب الشخص بالمؤسس من جهة الآباء؟ (شرط حمل لقب العائلة) */
function isPatrilineal(p) {
  let cur = p, guard = 0;
  while (cur && guard++ < 20) {
    if (cur.root) return true;
    cur = cur.f ? PEOPLE[cur.f] : null;
  }
  return false;
}

/* الاسم الكامل بسلسلة النسب: فلان بن فلان بن فلان + لقب العائلة لمن كان من صلبها أباً عن أب.
   أولاد البنت من زوجٍ خارجي لا يُلحق بهم اللقب — لقبهم في اسم أبيهم كما كُتب. */
function fullNasab(p) {
  let s = p.n;
  let cur = p, first = true, guard = 0;
  while (cur.f && PEOPLE[cur.f] && guard++ < 15) {
    const fa = PEOPLE[cur.f];
    s += (first && p.g === 'f' ? ' بنت ' : ' بن ') + fa.n;
    first = false;
    cur = fa;
  }
  if (isPatrilineal(p) && META?.familyName) s += ' ' + META.familyName;
  return s;
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return ''; }
}

/* ─────────── إضافة عائلة كاملة دفعة واحدة ─────────── */
let BULK = null;

function openBulkModal(presetFatherId) {
  BULK = { wifeId: '' };
  const males = Object.values(PEOPLE).filter(p => p.g === 'm').sort((a, b) => a.n.localeCompare(b.n, 'ar'));
  $('#bkFather').innerHTML =
    `<option value="">— اختر الأب —</option>` +
    males.map(p => `<option value="${p.id}">${esc(p.n)}</option>`).join('') +
    `<option value="__new__">＋ أبٌ جديد (مؤسس أعلى الشجرة)</option>` +
    `<option value="__inlaw__">＋ زوجٌ من خارج العائلة (اكتب اسمه)</option>`;
  $('#bkFather').value = presetFatherId || (males.length ? '' : '__new__');
  bkFatherChanged();
  $('#bkNewFather').value = '';
  $('#bkWife').value = '';
  $('#bkWifeSugg').innerHTML = '';
  setSeg('#bkCal', 'h');
  $('#bkRows').innerHTML = '';
  for (let i = 0; i < 4; i++) bkAddRow();
  $('#bkErr').textContent = '';
  openModal('#mdBulk');
}
function bkFatherChanged() {
  const v = $('#bkFather').value;
  const show = v === '__new__' || v === '__inlaw__';
  $('#bkNewFatherRow').style.display = show ? '' : 'none';
  if (show) {
    $('#bkNewFatherLabel').textContent = v === '__new__' ? 'اسم الأب الجديد' : 'اسم الزوج (من خارج العائلة)';
    $('#bkNewFather').placeholder = v === '__new__' ? 'سيوضع مؤسساً أعلى الشجرة' : 'زوج البنت — يظهر رقاقةً خضراء بجانبها';
  }
}
function bkAddRow() {
  const div = document.createElement('div');
  div.className = 'bkrow';
  div.innerHTML = `
    <input type="text" class="bk-name" placeholder="اسم الابن/البنت…">
    <button type="button" class="bk-g btn btn-sm" data-g="m">👦 ولد</button>
    <input type="number" class="bk-year" placeholder="سنة الميلاد">
    <button type="button" class="bk-x" title="حذف السطر">✕</button>`;
  div.querySelector('.bk-g').onclick = e => {
    const b = e.currentTarget;
    const m = b.dataset.g === 'm';
    b.dataset.g = m ? 'f' : 'm';
    b.textContent = m ? '👧 بنت' : '👦 ولد';
  };
  div.querySelector('.bk-x').onclick = () => { div.remove(); };
  div.querySelector('.bk-name').addEventListener('input', () => {
    const rows = $$('#bkRows .bkrow');
    if (rows.length && rows[rows.length - 1] === div && div.querySelector('.bk-name').value.trim()) bkAddRow();
  });
  $('#bkRows').appendChild(div);
}
function bkWifeSugg() {
  const q = $('#bkWife').value.trim();
  BULK.wifeId = '';
  const box = $('#bkWifeSugg');
  if (!q) { box.innerHTML = ''; return; }
  const cands = Object.values(PEOPLE).filter(x => x.g === 'f' && x.n.includes(q)).slice(0, 5);
  box.innerHTML = cands.length
    ? `<span class="hint">موجودة في الشجرة؟</span> ` +
      cands.map(c => `<button type="button" class="btn btn-sm" data-wlnk="${c.id}" style="margin:2px">🔗 ${esc(c.n)}</button>`).join('')
    : '';
  box.querySelectorAll('[data-wlnk]').forEach(b => b.onclick = () => {
    BULK.wifeId = b.dataset.wlnk;
    $('#bkWife').value = PEOPLE[b.dataset.wlnk].n;
    box.innerHTML = `<span class="hint">✓ ستُربط «${esc(PEOPLE[b.dataset.wlnk].n)}» زوجةً (دون إنشاء جديدة)</span>`;
  });
}
const newId = () => 'p_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

async function submitBulk() {
  const errEl = $('#bkErr');
  errEl.textContent = '';
  const cal = getSeg('#bkCal');
  const fSel = $('#bkFather').value;
  const rows = $$('#bkRows .bkrow').map(r => ({
    n: r.querySelector('.bk-name').value.trim(),
    g: r.querySelector('.bk-g').dataset.g,
    y: parseInt(r.querySelector('.bk-year').value, 10) || 0
  })).filter(r => r.n);
  if (!fSel) { errEl.textContent = 'اختر الأب أو أنشئ أباً/زوجاً جديداً'; return; }
  const newFather = fSel === '__new__' || fSel === '__inlaw__';
  if (newFather && !$('#bkNewFather').value.trim()) { errEl.textContent = 'اكتب الاسم'; return; }
  const wifeName = $('#bkWife').value.trim();
  if (!rows.length && !wifeName) { errEl.textContent = 'أضف زوجةً أو ابناً واحداً على الأقل'; return; }

  busy(true);
  try {
    // ١) الأب (جديد مؤسساً، أو زوجاً من خارج العائلة، أو موجود)
    let fatherId = fSel;
    if (newFather) {
      fatherId = newId();
      const fp = {
        id: fatherId, n: $('#bkNewFather').value.trim(), g: 'm',
        byh: 0, byg: 0, dyh: 0, dyg: 0, dead: false, mar: !!wifeName,
        ph: '', f: '', m: '', sp: [], root: fSel === '__new__', ord: 0,
        cb: SESSION.un, ub: '', ct: Date.now(), ut: 0
      };
      await DB.savePerson(fp, true);
      PEOPLE[fatherId] = fp;
    }
    const father = PEOPLE[fatherId];
    // ٢) الزوجة (ربط موجودة أو إنشاء جديدة)
    let wifeId = '';
    if (BULK.wifeId) {
      wifeId = BULK.wifeId;
      const w = PEOPLE[wifeId];
      if (!w.sp.includes(fatherId)) { w.sp.push(fatherId); w.mar = true; w.ub = SESSION.un; w.ut = Date.now(); await DB.savePerson(w, false); }
    } else if (wifeName) {
      wifeId = newId();
      const w = {
        id: wifeId, n: wifeName, g: 'f',
        byh: 0, byg: 0, dyh: 0, dyg: 0, dead: false, mar: true,
        ph: '', f: '', m: '', sp: [fatherId], root: false, ord: 0,
        cb: SESSION.un, ub: '', ct: Date.now(), ut: 0
      };
      await DB.savePerson(w, true);
      PEOPLE[wifeId] = w;
    }
    if (wifeId && !father.sp.includes(wifeId)) {
      father.sp.push(wifeId); father.mar = true; father.ub = SESSION.un; father.ut = Date.now();
      await DB.savePerson(father, false);
    }
    // ٣) الأبناء
    let ord = Object.values(PEOPLE).filter(c => c.f === fatherId).length;
    for (const r of rows) {
      ord++;
      const y = r.y ? (cal === 'h' ? { h: r.y, g: h2g(r.y) } : { h: g2h(r.y), g: r.y }) : { h: 0, g: 0 };
      const c = {
        id: newId(), n: r.n, g: r.g,
        byh: y.h, byg: y.g, dyh: 0, dyg: 0, dead: false, mar: false,
        ph: '', f: fatherId, m: wifeId, sp: [], root: false, ord,
        cb: SESSION.un, ub: '', ct: Date.now(), ut: 0
      };
      await DB.savePerson(c, true);
      PEOPLE[c.id] = c;
    }
    await DB.addLog('add', father.n, `إضافة عائلة كاملة: ${wifeName ? 'زوجة و' : ''}${arD(rows.length)} من الأبناء`);
    closeModal('#mdBulk');
    renderTree();
    toast(`أُضيفت عائلة «${father.n}» ✓ — لإكمال تفاصيل أي فرد اضغط عليه أو افتح «📋 الأفراد»`, 5000);
  } catch (e) {
    errEl.textContent = 'تعذّر الحفظ: ' + e.message;
  } finally { busy(false); }
}

/* ─────────── قائمة الأفراد (وصول سريع) ─────────── */
function openPeopleModal() {
  openModal('#mdPeople');
  $('#plSearch').value = '';
  renderPeopleList('');
  setTimeout(() => $('#plSearch').focus(), 50);
}
function renderPeopleList(q) {
  q = (q || '').trim();
  const rows = Object.values(PEOPLE)
    .filter(p => !q || p.n.includes(q))
    .sort((a, b) => a.n.localeCompare(b.n, 'ar'));
  $('#plCount').textContent = `${arD(rows.length)} من أصل ${arD(Object.keys(PEOPLE).length)}`;
  if (!rows.length) { $('#plList').innerHTML = '<tr><td colspan="4" class="muted">لا نتائج</td></tr>'; return; }
  $('#plList').innerHTML = rows.map(p => {
    const dotCls = bloodline(p) ? (p.g === 'm' ? 'm' : 'f') : 's';
    const father = p.f && PEOPLE[p.f];
    return `<tr>
      <td><span class="dot ${dotCls}" style="display:inline-block;vertical-align:middle;margin-inline-end:6px"></span><b>${esc(p.n)}</b>${p.dead ? ' <span class="deadband">متوفى</span>' : ''}</td>
      <td class="muted">${father ? esc(father.n) : (p.root ? '⭐ مؤسس' : '—')}</td>
      <td class="muted" style="white-space:nowrap">${p.byh ? arD(p.byh) + 'هـ' : '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" data-plv="${p.id}">👁 عرض</button>
        ${VIEW ? '' : `<button class="btn btn-sm" data-ple="${p.id}">✏️ تعديل</button>`}
        ${(!VIEW && SESSION?.role === 'owner') ? `<button class="btn btn-sm btn-danger" data-pld="${p.id}">🗑</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  $$('#plList [data-plv]').forEach(b => b.onclick = () => { closeModal('#mdPeople'); openPersonView(b.dataset.plv); });
  $$('#plList [data-ple]').forEach(b => b.onclick = () => { closeModal('#mdPeople'); openPersonForm(b.dataset.ple); });
  $$('#plList [data-pld]').forEach(b => b.onclick = () => {
    deletePerson(b.dataset.pld).then(() => { openModal('#mdPeople'); renderPeopleList($('#plSearch').value); });
  });
}

/* ─────────── حساب القرابة ─────────── */
function ancestorMap(id) {
  // id → {d: العمق، chain: [قائمة المعرّفات من الشخص حتى الجد شاملة]، steps:['f'|'m',...]}
  const out = {};
  const queue = [{ id, d: 0, chain: [id], steps: [] }];
  while (queue.length) {
    const cur = queue.shift();
    const p = PEOPLE[cur.id];
    if (!p) continue;
    for (const [pid, st] of [[p.f, 'f'], [p.m, 'm']]) {
      if (!pid || !PEOPLE[pid]) continue;
      if (out[pid]) continue;
      const rec = { d: cur.d + 1, chain: [...cur.chain, pid], steps: [...cur.steps, st] };
      out[pid] = rec;
      queue.push({ id: pid, ...rec, chain: rec.chain, steps: rec.steps });
    }
  }
  return out;
}

const W = {
  son: g => g === 'm' ? 'ابن' : 'بنت',
  sib: (g, full) => full ? (g === 'm' ? 'شقيق' : 'شقيقة') : (g === 'm' ? 'أخ' : 'أخت'),
  unc: (sideF, g) => sideF ? (g === 'm' ? 'عم' : 'عمة') : (g === 'm' ? 'خال' : 'خالة'),
};

/* سلسلة نزول: «ابن ابن …» */
function chainDown(gSelf, steps) {
  // steps: خطوات الصعود من الشخص، طولها n ⇒ الكلمات: نوعه ثم أجناس الوسطاء
  const words = [W.son(gSelf)];
  for (let i = 0; i < steps.length - 1; i++) words.push(W.son(steps[i] === 'f' ? 'm' : 'f'));
  return words.join(' ');
}
/* سلسلة صعود بالنسبة لشخص: أبيه/أمه/جدّه… */
function chainUp(steps) {
  if (!steps.length) return '';
  if (steps.length === 1) return steps[0] === 'f' ? 'أبيه' : 'أمه';
  if (steps.length === 2) return steps[1] === 'f' ? (steps[0] === 'f' ? 'جدّه لأبيه' : 'جدّه لأمه') : (steps[0] === 'f' ? 'جدّته لأبيه' : 'جدّته لأمه');
  return 'جدّه الأعلى';
}

function computeRelation(aId, bId) {
  const A = PEOPLE[aId], B = PEOPLE[bId];
  if (!A || !B) return null;
  if (aId === bId) return { text: 'هو نفس الشخص', path: [aId] };
  if ((A.sp || []).includes(bId)) {
    return { text: A.g === 'm' ? `زوجُ ${esc(B.n)}` : `زوجةُ ${esc(B.n)}`, path: [aId, bId] };
  }
  const ancA = ancestorMap(aId), ancB = ancestorMap(bId);

  // ب من أجداد أ ⇒ أ من ذريته
  if (ancA[bId]) {
    const r = ancA[bId];
    const d = r.d;
    let term;
    if (d === 1) term = A.g === 'm' ? 'ابن' : 'بنت';
    else if (d === 2) term = A.g === 'm' ? 'حفيد' : 'حفيدة';
    else term = (A.g === 'm' ? 'حفيد' : 'حفيدة') + ` من الدرجة ${arD(d - 1)} (` + chainDown(A.g, r.steps) + ')';
    return { text: `${term} لـ${esc(B.n)}`, path: r.chain };
  }
  // أ من أجداد ب
  if (ancB[aId]) {
    const r = ancB[aId];
    const d = r.d;
    const side = r.steps[0] === 'f' ? 'لأب' : 'لأم';
    let term;
    if (d === 1) term = A.g === 'm' ? 'والد' : 'والدة';
    else if (d === 2) term = (A.g === 'm' ? 'جدّ' : 'جدّة') + ' ' + side;
    else term = (A.g === 'm' ? 'جدّ' : 'جدّة') + ` من الدرجة ${arD(d - 1)} ${side}`;
    return { text: `${term} لـ${esc(B.n)}`, path: [...r.chain].reverse() };
  }

  // جد مشترك
  let best = null;
  for (const cid of Object.keys(ancA)) {
    if (!ancB[cid]) continue;
    const sum = ancA[cid].d + ancB[cid].d;
    if (!best || sum < best.sum) best = { cid, sum, ra: ancA[cid], rb: ancB[cid] };
  }
  if (best) {
    const { ra, rb, cid } = best;
    const dA = ra.d, dB = rb.d;
    const path = [...ra.chain, ...[...rb.chain].reverse().slice(1)];
    // إخوة
    if (dA === 1 && dB === 1) {
      const full = A.f && A.f === B.f && A.m && A.m === B.m;
      let term;
      if (full) term = W.sib(A.g, true);
      else if (A.f && A.f === B.f) term = W.sib(A.g, false) + ' لأب';
      else term = W.sib(A.g, false) + ' لأم';
      return { text: `${term} لـ${esc(B.n)}`, path };
    }
    // أ عمّ/خال (أو أعلى) لـ ب
    if (dA === 1 && dB >= 2) {
      const sideF = rb.steps[dB - 2] === 'f'; // هل الواصل أبٌ أم أم
      const j = W.unc(sideF, A.g);
      const up = chainUp(rb.steps.slice(0, dB - 2));
      return { text: `${j}${up ? ' ' + up : ''} — أي ${j} ${up || 'مباشر'} لـ${esc(B.n)}`.replace(' — أي ' + j + '  لـ', ' لـ').replace('عم مباشر', 'عم').replace('خال مباشر', 'خال'), path, simple: `${j}${up ? ' ' + up : ''} لـ${esc(B.n)}` };
    }
    // أ ابن أخ/أخت لـ ب
    if (dA >= 2 && dB === 1) {
      const sibG = ra.steps[dA - 2]; // جنس الواصل (أخو ب أو أخته)
      const down = chainDown(A.g, ra.steps.slice(0, dA - 1));
      const sibWord = sibG === 'f' ? 'أخي' : 'أخت';
      return { text: `${down} ${sibG === 'f' ? 'أخيه' : 'أخته'} — أي ${down} ${sibWord} ${esc(B.n)}`, path, simple: `${down} ${sibG === 'f' ? 'أخي' : 'أخت'} ${esc(B.n)}` };
    }
    // أبناء عمومة/خؤولة
    if (dA >= 2 && dB >= 2) {
      const paG = ra.steps[dA - 2] === 'f' ? 'm' : 'f';   // جنس ابن الجد من جهة أ
      const sideF = rb.steps[dB - 2] === 'f';
      const j = W.unc(sideF, paG);
      const down = chainDown(A.g, ra.steps.slice(0, dA - 1));
      const up = chainUp(rb.steps.slice(0, dB - 2));
      return { text: `${down} ${j}${up ? ' ' + up : ''} لـ${esc(B.n)}`, path };
    }
  }

  // قرابة عبر زواج (درجة واحدة)
  for (const sid of A.sp || []) {
    const s = PEOPLE[sid];
    if (!s) continue;
    const r = computeRelationBlood(sid, bId);
    if (r) return { text: `${A.g === 'm' ? 'زوج' : 'زوجة'} ${r.inner} (${esc(s.n)})`, path: [aId, ...r.path] };
  }
  for (const sid of B.sp || []) {
    const s = PEOPLE[sid];
    if (!s) continue;
    const r = computeRelationBlood(aId, sid);
    if (r) return { text: `${r.inner} لزوج${s.g === 'f' ? 'ة' : ''} ${esc(B.n)} (${esc(s.n)})`, path: [...r.path, bId] };
  }
  return { text: 'لا توجد صلة قرابة مباشرة مسجّلة في الشجرة', path: [] };
}

/* نسخة مختصرة للقرابة الدموية فقط (للاستخدام عبر الزواج) */
function computeRelationBlood(aId, bId) {
  const A = PEOPLE[aId], B = PEOPLE[bId];
  if (!A || !B || aId === bId) return null;
  const ancA = ancestorMap(aId), ancB = ancestorMap(bId);
  if (ancA[bId]) {
    const d = ancA[bId].d;
    const t = d === 1 ? W.son(A.g) : d === 2 ? (A.g === 'm' ? 'حفيد' : 'حفيدة') : 'من ذرية';
    return { inner: `${t} ${esc(B.n)}`, path: ancA[bId].chain };
  }
  if (ancB[aId]) {
    const d = ancB[aId].d;
    const t = d === 1 ? (A.g === 'm' ? 'والد' : 'والدة') : (A.g === 'm' ? 'جدّ' : 'جدّة');
    return { inner: `${t} ${esc(B.n)}`, path: [...ancB[aId].chain].reverse() };
  }
  let best = null;
  for (const cid of Object.keys(ancA)) {
    if (!ancB[cid]) continue;
    const sum = ancA[cid].d + ancB[cid].d;
    if (!best || sum < best.sum) best = { cid, sum, ra: ancA[cid], rb: ancB[cid] };
  }
  if (!best) return null;
  const { ra, rb } = best;
  const dA = ra.d, dB = rb.d;
  const path = [...ra.chain, ...[...rb.chain].reverse().slice(1)];
  if (dA === 1 && dB === 1) return { inner: `${W.sib(A.g, A.f === B.f && A.m === B.m)} ${esc(B.n)}`, path };
  if (dA === 1 && dB >= 2) return { inner: `${W.unc(rb.steps[dB - 2] === 'f', A.g)} ${chainUp(rb.steps.slice(0, dB - 2)) || ''} ${esc(B.n)}`.replace(/\s+/g, ' '), path };
  if (dA >= 2 && dB === 1) return { inner: `${chainDown(A.g, ra.steps.slice(0, dA - 1))} ${ra.steps[dA - 2] === 'f' ? 'أخي' : 'أخت'} ${esc(B.n)}`, path };
  const paG = ra.steps[dA - 2] === 'f' ? 'm' : 'f';
  return { inner: `${chainDown(A.g, ra.steps.slice(0, dA - 1))} ${W.unc(rb.steps[dB - 2] === 'f', paG)} ${chainUp(rb.steps.slice(0, dB - 2)) || ''} ${esc(B.n)}`.replace(/\s+/g, ' '), path };
}

/* وضع القرابة التفاعلي: اضغط بطاقةً ثم أخرى فتنبثق النتيجة */
let RELMODE = null;

function startRelMode(presetA) {
  RELMODE = { a: presetA || null };
  $$('#canvas .hit').forEach(el => el.classList.remove('hit'));
  if (RELMODE.a) highlightPerson(RELMODE.a);
  $('#relBannerText').textContent = RELMODE.a
    ? `اضغط بطاقة الشخص الآخر لمعرفة قرابته بـ«${PEOPLE[RELMODE.a]?.n || ''}»`
    : 'اضغط بطاقة الشخص الأول';
  $('#relBanner').style.display = '';
}
function highlightPerson(id) {
  $$(`#canvas [data-id="${id}"]`).forEach(el => el.classList.add('hit'));
}
function cancelRelMode() {
  RELMODE = null;
  $('#relBanner').style.display = 'none';
  $$('#canvas .hit').forEach(el => el.classList.remove('hit'));
}
function pickRelPerson(id) {
  if (!RELMODE) return;
  if (!RELMODE.a) {
    RELMODE.a = id;
    highlightPerson(id);
    $('#relBannerText').textContent = `اضغط بطاقة الشخص الآخر لمعرفة قرابته بـ«${PEOPLE[id]?.n || ''}»`;
    return;
  }
  if (id === RELMODE.a) { toast('هذا هو الشخص الأول — اختر غيره'); return; }
  const a = RELMODE.a;
  cancelRelMode();
  const r = computeRelation(a, id);
  const names = r.path.map(x => `<span class="rp">${esc(PEOPLE[x]?.n || '؟')}</span>`).join(' ← ');
  $('#relResultBody').innerHTML = `
    <div class="rel-result on" style="margin-top:0">
      <div><b>${esc(PEOPLE[a].n)}</b> هو<br><span class="relword">${r.simple || r.text}</span></div>
      ${r.path.length > 1 ? `<div class="rel-path">سلسلة النسب: ${names}</div>` : ''}
    </div>
    <button class="btn" id="relAgain" style="margin-top:12px;width:100%">🧭 قرابة أخرى</button>`;
  $('#relAgain').onclick = () => { closeModal('#mdRel'); startRelMode(null); };
  openModal('#mdRel');
}

/* ─────────── التصدير PDF ─────────── */
function openExportModal() {
  const opts = Object.values(PEOPLE).filter(bloodline).sort((a, b) => a.n.localeCompare(b.n, 'ar'))
    .map(p => `<option value="${p.id}">${esc(p.n)}</option>`).join('');
  $('#expPerson').innerHTML = opts;
  $('#expPersonRow').style.display = 'none';
  setSeg('#expScope', 'all');
  openModal('#mdExport');
}
function doExport(personId) {
  const scopeAll = !personId;
  let roots;
  if (scopeAll) {
    roots = Object.values(PEOPLE).filter(p => p.root).sort((a, b) => (a.ord || 99) - (b.ord || 99));
  } else {
    roots = [PEOPLE[personId]];
  }
  if (!roots.length || !roots[0]) { toast('لا يوجد ما يُصدَّر'); return; }
  const count = scopeAll ? Object.keys(PEOPLE).length : countBranch(roots[0]);
  const title = scopeAll
    ? `شجرة ${META?.familyName || 'العائلة'}`
    : `فرع ${roots[0].n} — من شجرة ${META?.familyName || 'العائلة'}`;
  const pa = $('#printArea');
  pa.innerHTML = `
    <div class="print-head">
      <h1>🌳 ${esc(title)}</h1>
      <div class="print-sub">${arD(count)} فرداً • ${fmtDate(Date.now())}</div>
      <div class="print-legend">
        <span><span class="dot m"></span> ذكور</span>
        <span><span class="dot f"></span> إناث</span>
        <span><span class="dot s"></span> أزواج وزوجات</span>
        <span><span class="dot d"></span> شريط أسود: متوفى</span>
      </div>
    </div>
    <div id="printTree">${treeHTML(roots)}</div>`;
  // ملاءمة العرض لصفحة A4 عرضية: إظهار مؤقت خارج الشاشة للقياس
  pa.style.cssText = 'display:block;position:absolute;left:-99999px;top:0';
  const w = $('#printTree').scrollWidth || 1;
  $('#printTree').style.zoom = Math.min(1, 1040 / w);
  pa.style.cssText = '';
  window.print();
}
function countBranch(p) {
  let n = 1 + (p.sp || []).filter(x => PEOPLE[x]).length;
  childrenOf(p).forEach(k => n += countBranch(k));
  return n;
}

/* ─────────── الأدمنية (للمالك) ─────────── */
async function openAdminsModal() {
  openModal('#mdAdmins');
  $('#admList').innerHTML = '<tr><td colspan="4" class="muted">جارٍ التحميل…</td></tr>';
  try {
    const users = await DB.listUsers();
    $('#admList').innerHTML = users.sort((a, b) => (a.role === 'owner' ? -1 : 1)).map(u => `
      <tr>
        <td><b>${esc(u.un)}</b></td>
        <td><span class="rolechip ${u.role}">${u.role === 'owner' ? 'الأدمن الأكبر' : 'أدمن'}</span></td>
        <td class="muted">${u.ct ? fmtDate(u.ct) : ''}</td>
        <td>${u.role !== 'owner' ? `<button class="btn btn-sm btn-danger" data-deladm="${u.id}" data-un="${esc(u.un)}">إزالة</button>` : ''}</td>
      </tr>`).join('');
    $$('#admList [data-deladm]').forEach(b => b.onclick = async () => {
      if (!confirm(`إزالة صلاحيات الأدمن «${b.dataset.un}»؟ لن يستطيع الدخول بعدها.`)) return;
      busy(true);
      try {
        await fsReq('DELETE', `/ft_users/${b.dataset.deladm}`);
        await DB.addLog('admin_del', b.dataset.un, 'إزالة أدمن');
        toast(`أُزيل «${b.dataset.un}»`);
        openAdminsModal();
      } catch (e) { toast('تعذّرت الإزالة: ' + e.message); }
      finally { busy(false); }
    });
  } catch (e) {
    $('#admList').innerHTML = `<tr><td colspan="4" class="muted">تعذّر التحميل: ${esc(e.message)}</td></tr>`;
  }
}

async function addAdmin() {
  const un = $('#admUser').value.trim().toLowerCase();
  const p1 = $('#admPass').value, p2 = $('#admPass2').value;
  const errEl = $('#admErr');
  errEl.textContent = '';
  if (!UN_RE.test(un)) { errEl.textContent = 'اسم المستخدم: حروف إنجليزية صغيرة وأرقام (٣–٢٠ حرفاً)'; return; }
  if (p1.length < 6) { errEl.textContent = 'كلمة المرور ٦ أحرف على الأقل'; return; }
  if (p1 !== p2) { errEl.textContent = 'كلمتا المرور غير متطابقتين'; return; }
  if (DEMO) { toast('في الوضع التجريبي لا تُنشأ حسابات حقيقية'); return; }
  busy(true);
  try {
    const data = await authReq('signUp', { email: unToEmail(un), password: p1, returnSecureToken: true });
    await fsReq('PATCH', `/ft_users/${data.localId}`, fsEnc({ un, role: 'admin', ct: Date.now() }));
    await DB.addLog('admin_add', un, 'إضافة أدمن جديد');
    $('#admUser').value = ''; $('#admPass').value = ''; $('#admPass2').value = '';
    toast(`أُنشئ حساب الأدمن «${un}» ✓`);
    openAdminsModal();
  } catch (e) { errEl.textContent = authErrMsg(e); }
  finally { busy(false); }
}

/* ─────────── السجل ─────────── */
const LOG_LABELS = { add: '➕ إضافة', edit: '✏️ تعديل', del: '🗑 حذف', admin_add: '👤 إضافة أدمن', admin_del: '👤 إزالة أدمن' };
async function openLogModal() {
  openModal('#mdLog');
  $('#logList').innerHTML = '<tr><td colspan="4" class="muted">جارٍ التحميل…</td></tr>';
  try {
    const log = await DB.listLog();
    if (!log.length) { $('#logList').innerHTML = '<tr><td colspan="4" class="muted">لا سجلات بعد</td></tr>'; return; }
    $('#logList').innerHTML = log.slice(0, 300).map(l => `
      <tr>
        <td class="muted" style="white-space:nowrap">${fmtDateTime(l.ts)}</td>
        <td><b>${esc(l.u)}</b></td>
        <td>${LOG_LABELS[l.a] || esc(l.a)}</td>
        <td>${esc(l.p)}</td>
      </tr>`).join('');
  } catch (e) {
    $('#logList').innerHTML = `<tr><td colspan="4" class="muted">تعذّر التحميل: ${esc(e.message)}</td></tr>`;
  }
}
function fmtDateTime(ts) {
  try { return new Date(ts).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}

/* ─────────── الإقلاع وربط الأحداث ─────────── */
async function enterApp() {
  $('#screen-login').style.display = 'none';
  $('#screen-app').classList.add('on');
  $('#whoName').textContent = SESSION.un;
  $('#whoRole').textContent = SESSION.role === 'owner' ? '(الأدمن الأكبر)' : '(أدمن)';
  $('#btnAdmins').style.display = SESSION.role === 'owner' ? '' : 'none';
  $('#brandName').textContent = META?.familyName ? `شجرة ${META.familyName}` : 'شجرة العائلة';
  document.title = META?.familyName ? `شجرة ${META.familyName}` : 'شجرة العائلة';
  $('#demoBadge').style.display = DEMO ? '' : 'none';
  busy(true);
  try {
    if (!DEMO && !META) { try { const doc = await fsReq('GET', '/ft_meta/setup'); META = fsDec(doc); $('#brandName').textContent = `شجرة ${META.familyName}`; } catch {} }
    await DB.loadPeople();
    renderTree();
  } catch (e) {
    toast('تعذّر تحميل الشجرة: ' + e.message, 5000);
  } finally { busy(false); }
}

/* ─────────── العرض العام (قراءة فقط + اقتراحات) ─────────── */
async function enterView() {
  $('#screen-login').style.display = 'none';
  $('#screen-app').classList.add('on');
  $('#whoName').textContent = 'زائر';
  $('#whoRole').textContent = '(عرض عام)';
  ['#fabAdd', '#fabFamily', '#btnLog', '#btnAdmins', '#btnComments', '#btnReload'].forEach(s => { const el = $(s); if (el) el.style.display = 'none'; });
  $('#btnLogout').textContent = '🔑 دخول الأدمنية';
  $('#btnLogout').onclick = () => location.href = 'index.html';
  $('#fabComment').style.display = '';
  $('#brandName').textContent = 'شجرة العائلة';
  $('#demoBadge').style.display = DEMO ? '' : 'none';
  busy(true);
  try {
    if (DEMO) META = (demoLoad() || demoSeed()).meta;
    else { try { const doc = await fsReq('GET', '/ft_meta/setup', null, true); META = fsDec(doc); } catch {} }
    if (META?.familyName) { $('#brandName').textContent = `شجرة ${META.familyName}`; document.title = `شجرة ${META.familyName}`; }
    await DB.loadPeople();
    renderTree();
  } catch (e) {
    toast('تعذّر تحميل الشجرة: ' + e.message, 5000);
  } finally { busy(false); }
}

/* وسم الاقتراح بفرد معيّن */
let CMT_TAG = null;
function renderCmtTag() {
  const el = $('#cmTag');
  el.innerHTML = CMT_TAG
    ? `<span class="spchip">🔗 مرتبط بـ: ${esc(CMT_TAG.name)} <a id="cmTagX" style="cursor:pointer;color:var(--danger)">✕</a></span>`
    : `<span class="hint">اقتراح عام — ولربطه بفرد معيّن: افتح بطاقته واضغط «💬 اقتراح على هذا الفرد»</span>`;
  const x = $('#cmTagX');
  if (x) x.onclick = () => { CMT_TAG = null; renderCmtTag(); };
}

async function submitComment() {
  const name = $('#cmName').value.trim();
  const text = $('#cmText').value.trim();
  const errEl = $('#cmErr');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'اكتب اسمك'; return; }
  if (!text) { errEl.textContent = 'اكتب اقتراحك'; return; }
  if (text.length > 1000) { errEl.textContent = 'الاقتراح طويل جداً (الحد ١٠٠٠ حرف)'; return; }
  busy(true);
  try {
    await DB.addComment(name.slice(0, 60), text, CMT_TAG);
    $('#cmText').value = '';
    CMT_TAG = null;
    closeModal('#mdComment');
    toast(`شكراً «${name}» — وصل اقتراحك للأدمنية ✓`, 4000);
  } catch (e) { errEl.textContent = 'تعذّر الإرسال: ' + e.message; }
  finally { busy(false); }
}

async function openCommentsModal() {
  openModal('#mdComments');
  $('#cmList').innerHTML = '<tr><td colspan="4" class="muted">جارٍ التحميل…</td></tr>';
  try {
    const list = await DB.listComments();
    if (!list.length) { $('#cmList').innerHTML = '<tr><td colspan="4" class="muted">لا اقتراحات بعد — شارك رابط العرض العام مع العائلة</td></tr>'; return; }
    $('#cmList').innerHTML = list.map(c => `
      <tr>
        <td class="muted" style="white-space:nowrap">${fmtDateTime(c.ts)}</td>
        <td><b>${esc(c.n)}</b></td>
        <td style="white-space:pre-wrap">${esc(c.t)}${c.pid ? `<br><button class="btn btn-sm" data-cgo="${esc(c.pid)}" style="margin-top:5px">🔗 ${esc(c.pn || 'الفرد المعني')} — افتح بطاقته</button>` : ''}</td>
        <td>${SESSION?.role === 'owner' && c.id ? `<button class="btn btn-sm btn-danger" data-delcm="${esc(c.id)}">🗑</button>` : ''}</td>
      </tr>`).join('');
    $$('#cmList [data-cgo]').forEach(b => b.onclick = () => {
      const pid = b.dataset.cgo;
      if (!PEOPLE[pid]) { toast('هذا الفرد لم يعد موجوداً في الشجرة'); return; }
      closeModal('#mdComments');
      openPersonView(pid);
    });
    $$('#cmList [data-delcm]').forEach(b => b.onclick = async () => {
      if (!confirm('حذف هذا الاقتراح؟')) return;
      busy(true);
      try { await DB.deleteComment(b.dataset.delcm); openCommentsModal(); }
      catch (e) { toast('تعذّر الحذف: ' + e.message); }
      finally { busy(false); }
    });
  } catch (e) {
    $('#cmList').innerHTML = `<tr><td colspan="4" class="muted">تعذّر التحميل: ${esc(e.message)}</td></tr>`;
  }
}

function showLogin() {
  $('#screen-login').style.display = 'flex';
  $('#screen-app').classList.remove('on');
  $('#setupLink').style.display = SETUP_LOCKED ? 'none' : '';
  $('#loginFamName').textContent = META?.familyName ? `شجرة ${META.familyName}` : 'شجرة العائلة';
}

function bindEvents() {
  // دخول
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const un = $('#liUser').value.trim().toLowerCase();
    const pw = $('#liPass').value;
    const errEl = $('#liErr');
    errEl.textContent = '';
    if (!UN_RE.test(un)) { errEl.textContent = 'اسم المستخدم: حروف إنجليزية صغيرة وأرقام فقط'; return; }
    busy(true);
    try { await doLogin(un, pw); await enterApp(); }
    catch (e2) { errEl.textContent = e2.code ? authErrMsg(e2) : e2.message; }
    finally { busy(false); }
  });

  // الإعداد الأول
  $('#setupLink').addEventListener('click', () => {
    $('#loginForm').style.display = 'none';
    $('#setupForm').style.display = '';
  });
  $('#backToLogin').addEventListener('click', e => {
    e.preventDefault();
    $('#setupForm').style.display = 'none';
    $('#loginForm').style.display = '';
  });
  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fam = $('#suFam').value.trim();
    const un = $('#suUser').value.trim().toLowerCase();
    const p1 = $('#suPass').value, p2 = $('#suPass2').value;
    const errEl = $('#suErr');
    errEl.textContent = '';
    if (!fam) { errEl.textContent = 'اكتب اسم العائلة'; return; }
    if (!UN_RE.test(un)) { errEl.textContent = 'اسم المستخدم: حروف إنجليزية صغيرة وأرقام (٣–٢٠)'; return; }
    if (p1.length < 6) { errEl.textContent = 'كلمة المرور ٦ أحرف على الأقل'; return; }
    if (p1 !== p2) { errEl.textContent = 'كلمتا المرور غير متطابقتين'; return; }
    busy(true);
    try { await doSetup(fam, un, p1); await enterApp(); toast('تم الإعداد! أنت الآن الأدمن الأكبر 🎉', 4000); }
    catch (e2) { errEl.textContent = e2.code ? authErrMsg(e2) : ('تعذّر الإعداد: ' + e2.message); }
    finally { busy(false); }
  });

  // شريط الأدوات
  $('#btnLogout').onclick = () => { sessionClear(); location.reload(); };
  $('#btnRel').onclick = () => startRelMode();
  $('#relCancel').onclick = cancelRelMode;
  $('#btnExport').onclick = openExportModal;
  $('#btnLog').onclick = openLogModal;
  $('#btnAdmins').onclick = openAdminsModal;
  $('#btnComments').onclick = openCommentsModal;
  $('#btnPeople').onclick = openPeopleModal;
  $('#plSearch').addEventListener('input', e => renderPeopleList(e.target.value));
  $('#fabComment').onclick = () => { CMT_TAG = null; renderCmtTag(); $('#cmErr').textContent = ''; openModal('#mdComment'); setTimeout(() => $('#cmName').focus(), 50); };
  $('#cmSend').onclick = submitComment;
  $('#pfFather').addEventListener('change', () => {
    const cur = $('#pfMother').value;
    $('#pfMother').innerHTML = motherOptions(cur, FORM?.editId, $('#pfFather').value);
    updateOrdHint();
  });
  $('#btnReload').onclick = async () => { busy(true); try { await DB.loadPeople(); renderTree(); toast('حُدّثت الشجرة'); } finally { busy(false); } };
  $('#fabAdd').onclick = () => openPersonForm(null);
  $('#fabFamily').onclick = () => openBulkModal();
  $('#bkFather').addEventListener('change', bkFatherChanged);
  $('#bkWife').addEventListener('input', bkWifeSugg);
  $('#bkSave').onclick = submitBulk;
  $$('#bkCal button').forEach(b => b.onclick = () => setSeg('#bkCal', b.dataset.v));
  $('#searchBox').addEventListener('input', e => doSearch(e.target.value));

  // إغلاق المودالات
  $$('.overlay .x').forEach(b => b.onclick = () => b.closest('.overlay').classList.remove('on'));
  $$('.overlay').forEach(ov => ov.addEventListener('pointerdown', e => { if (e.target === ov) ov.classList.remove('on'); }));

  // نموذج الشخص
  $$('#pfGender button').forEach(b => b.onclick = () => { setSeg('#pfGender', b.dataset.v); renderSpouseChips(); });
  $$('#pfCal button').forEach(b => b.onclick = () => { setSeg('#pfCal', b.dataset.v); updateBirthHint(); });
  $$('#pfDCal button').forEach(b => b.onclick = () => { setSeg('#pfDCal', b.dataset.v); updateDeathHint(); });
  $('#pfBirth').addEventListener('input', updateBirthHint);
  $('#pfDeath').addEventListener('input', updateDeathHint);
  $('#pfMar').onchange = toggleSub;
  $('#pfDead').onchange = toggleSub;
  $('#pfSave').onclick = submitPersonForm;
  $('#pfSpouseName').addEventListener('input', renderSpouseSugg);
  $('#pfSpouseName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSpouseFromInput(); } });
  $('#pfSpouseAddBtn').onclick = addSpouseFromInput;
  $('#pfPhoto').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { FORM.photo = await compressPhoto(f); renderPhotoPrev(); }
    catch { toast('تعذّرت قراءة الصورة'); }
    e.target.value = '';
  });
  $('#pfPhotoDel').onclick = () => { FORM.photo = ''; renderPhotoPrev(); };

  // التصدير
  $$('#expScope button').forEach(b => b.onclick = () => {
    setSeg('#expScope', b.dataset.v);
    $('#expPersonRow').style.display = b.dataset.v === 'branch' ? '' : 'none';
  });
  $('#expGo').onclick = () => {
    const scope = getSeg('#expScope');
    closeModal('#mdExport');
    doExport(scope === 'branch' ? $('#expPerson').value : null);
  };

  // الأدمنية
  $('#admAdd').onclick = addAdmin;
}
/* بيان ترتيب الإخوة الحالي تحت حقل الترتيب */
function updateOrdHint() {
  const el = $('#pfOrdHint');
  if (!el) return;
  const fid = $('#pfFather').value;
  if (!fid || fid === '__root__' || !PEOPLE[fid]) { el.textContent = ''; return; }
  const sibs = Object.values(PEOPLE)
    .filter(c => c.f === fid && c.id !== FORM?.editId)
    .sort((a, b) => (a.ord || 99) - (b.ord || 99) || (a.byg || 9999) - (b.byg || 9999));
  if (!sibs.length) { el.textContent = 'لا إخوة له بعد — سيكون الأول'; return; }
  el.innerHTML = 'إخوته حالياً: ' + sibs.map(s => `<b>${s.ord ? arD(s.ord) : '؟'}</b> ${esc(s.n)}`).join('، ') +
    '<br>اتركه فارغاً فيُرتَّب تلقائياً بسنة ميلاده — وإن كتبت رقماً محجوزاً تزحزح مَن بعده تلقائياً';
}

function updateBirthHint() {
  const y = parseInt($('#pfBirth').value, 10);
  const cal = getSeg('#pfCal');
  $('#pfBirthHint').textContent = y ? (cal === 'h' ? `يوافق ${arD(h2g(y))}م تقريباً` : `يوافق ${arD(g2h(y))}هـ تقريباً`) : '';
}
function updateDeathHint() {
  const y = parseInt($('#pfDeath').value, 10);
  const cal = getSeg('#pfDCal');
  $('#pfDeathHint').textContent = y ? (cal === 'h' ? `يوافق ${arD(h2g(y))}م تقريباً` : `يوافق ${arD(g2h(y))}هـ تقريباً`) : '';
}

/* ─────────── لقطات الدليل: ?shot=<state> يفتح الشاشة المطلوبة تلقائياً ─────────── */
async function runShot(s) {
  try {
    if (s === 'card') openPersonView('p3');
    else if (s === 'form') openPersonForm(null);
    else if (s === 'spouse') {
      openPersonForm('p3');
      $('#pfSpouseName').value = 'سارة';
      renderSpouseSugg();
      setTimeout(() => { const b = $('#mdForm .modal-body'); b.scrollTop = b.scrollHeight; }, 150);
    }
    else if (s === 'list') openPeopleModal();
    else if (s === 'rel') { startRelMode('p8'); pickRelPerson('p12'); }
    else if (s === 'export') openExportModal();
    else if (s === 'admins') openAdminsModal();
    else if (s === 'log') {
      await DB.addLog('add', 'عباس', 'إضافة فرد');
      await DB.addLog('edit', 'محمد', 'تعديل بيانات');
      await DB.addLog('del', 'تجربة قديمة', 'حذف من الشجرة');
      openLogModal();
    }
    else if (s === 'comments') {
      await DB.addComment('أبو أحمد', 'أضيفوا أولاد ياسين: محمد (١٤٣٥هـ) وعلي (١٤٣٨هـ)', { id: 'p13', name: 'ياسين' });
      await DB.addComment('أم فاطمة', 'سنة ميلاد ليلى الصحيحة ١٣٩٤هـ وليست ١٣٩٢هـ', { id: 'p12', name: 'ليلى' });
      openCommentsModal();
    }
    else if (s === 'comment') {
      CMT_TAG = { id: 'p13', name: 'ياسين' };
      renderCmtTag();
      openModal('#mdComment');
    }
    else if (s === 'bulk') {
      openBulkModal();
      $('#bkFather').value = 'p8'; bkFatherChanged();
      $('#bkWife').value = 'فاطمة';
      const names = [['قاسم', 'm', '1410'], ['زهراء', 'f', '1413'], ['صادق', 'm', '1416']];
      const rows = $$('#bkRows .bkrow');
      names.forEach((nm, i) => {
        if (!rows[i]) return;
        rows[i].querySelector('.bk-name').value = nm[0];
        if (nm[1] === 'f') { rows[i].querySelector('.bk-g').dataset.g = 'f'; rows[i].querySelector('.bk-g').textContent = '👧 بنت'; }
        rows[i].querySelector('.bk-year').value = nm[2];
      });
    }
  } catch (e) { console.warn('shot', e); }
}
window.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.ver').forEach(el => el.textContent = 'الإصدار ' + APP_VERSION);
  bindEvents();
  initViewport();
  if (VIEW) {
    await enterView();
    const vshot = new URLSearchParams(location.search).get('shot');
    if (vshot) setTimeout(() => runShot(vshot), 900);
    return;
  }
  busy(true);
  try {
    await DB.loadMeta();
    if (await tryResume()) await enterApp();
    else showLogin();
  } catch (e) {
    showLogin();
    toast('تعذّر الاتصال: ' + e.message, 5000);
  } finally { busy(false); }
  const SHOT = new URLSearchParams(location.search).get('shot');
  if (SHOT) setTimeout(() => runShot(SHOT), 900);
});
