/* ═══════════════════ شجرة العائلة — المنطق ═══════════════════ */
'use strict';

const APP_VERSION = '٣٠';

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
const FILL = new URLSearchParams(location.search).get('fill');   // نموذج تعبئة ذاتية لفرد

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

/* ─── تحويل التواريخ الكاملة (أم القرى عبر Intl) ─── */
const HMONTHS = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
const GMONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

let _hFmt = null;
function hijriParts(dateObj) {
  try {
    if (!_hFmt) _hFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const p = {};
    for (const x of _hFmt.formatToParts(dateObj)) if (x.type !== 'literal') p[x.type] = parseInt(x.value, 10);
    return (p.year && p.month && p.day) ? { y: p.year, m: p.month, d: p.day } : null;
  } catch { return null; }
}
/* ميلادي كامل → هجري كامل */
function gDateToH(gy, gm, gd) {
  return hijriParts(new Date(Date.UTC(gy, gm - 1, gd)));
}
/* هجري كامل → ميلادي كامل (تقدير ثم مطابقة) */
function hDateToG(hy, hm, hd) {
  const approx = Date.UTC(622, 6, 19) + Math.round(((hy - 1) * 354.367 + (hm - 1) * 29.531 + (hd - 1)) * 86400000);
  for (let off = -20; off <= 20; off++) {
    const dt = new Date(approx + off * 86400000);
    const h = hijriParts(dt);
    if (h && h.y === hy && h.m === hm && h.d === hd) return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  return null;
}
/* نص التاريخ بالتقويمين (يوم وشهر إن وُجدا، وإلا السنة وحدها) */
function fullDateLabel(p, k) {
  const hy = k === 'b' ? p.byh : p.dyh, gy = k === 'b' ? p.byg : p.dyg;
  const hm = k === 'b' ? p.bm : p.dm, hd = k === 'b' ? p.bd : p.dd;
  const gm = k === 'b' ? p.bmg : p.dmg, gd = k === 'b' ? p.bdg : p.ddg;
  if (!hy && !gy) return '';
  const h = (hm && hd) ? `${arD(hd)} ${HMONTHS[hm - 1]} ${arD(hy)}هـ` : (hy ? `${arD(hy)}هـ` : '');
  const g = (gm && gd) ? `${arD(gd)} ${GMONTHS[gm - 1]} ${arD(gy)}م` : (gy ? `${arD(gy)}م` : '');
  return [h, g].filter(Boolean).join(' — ');
}

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
    let msg = data?.error?.message || res.statusText;
    if (res.status === 429 || /quota/i.test(msg)) {
      msg = 'تجاوزنا الحد اليومي المجاني لقاعدة البيانات — يعود تلقائياً بعد منتصف الليل (توقيت أمريكا الغربية ≈ ١١ صباحاً بتوقيتنا)';
    }
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

/* ═══════ ذاكرة محلية للشجرة: قراءة واحدة بدل مئات ═══════
   نحفظ نسخة الشجرة في الجهاز مع رقم مراجعة (rev) في وثيقة ft_meta/state.
   كل فتحة تقرأ الرقم فقط (قراءة واحدة)، ولا تُنزّل الشجرة إلا إن تغيّر. */
const CACHE_KEY = 'ft_cache_v1';

function cacheLoad() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function cacheSave(rev, people) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rev, ts: Date.now(), people }));
  } catch (e) { console.warn('cache', e.name); }   // مساحة ممتلئة: نتجاهل بهدوء
}
async function fetchRev() {
  try {
    const d = await fsReq('GET', '/ft_meta/state', null, true);
    return fsDec(d).rev || 0;
  } catch (e) {
    if (e.status === 404) return 0;                // لم تُنشأ بعد
    throw e;
  }
}
let _revTimer = null;
function scheduleRevBump() {
  if (DEMO) return;
  clearTimeout(_revTimer);
  _revTimer = setTimeout(async () => {
    const rev = Date.now();
    try { await fsReq('PATCH', '/ft_meta/state', fsEnc({ rev })); cacheSave(rev, PEOPLE); }
    catch (e) { console.warn('rev', e.message); }
  }, 1500);
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
  async loadPeople(force = false) {
    if (DEMO) { PEOPLE = structuredClone((demoLoad() || demoSeed()).people); return; }
    const cached = cacheLoad();
    let rev = 0;
    try {
      rev = await fetchRev();                                  // قراءة واحدة فقط
      if (!force && rev && cached && cached.rev === rev && cached.people) {
        PEOPLE = cached.people;                                // لا جديد → من الذاكرة المحلية
        return;
      }
    } catch (e) {
      if (cached?.people) {                                    // تعذّر الاتصال → آخر نسخة محفوظة
        PEOPLE = cached.people;
        toast('تعذّر الاتصال بالخادم — عُرضت آخر نسخة محفوظة في جهازك', 6000);
        return;
      }
      throw e;
    }
    // تنزيل كامل (أول مرة أو بعد تغيير)
    try {
      const fresh = {};
      let pageToken = '';
      do {
        const data = await fsReq('GET', `/ft_people?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`);
        (data.documents || []).forEach(doc => { const p = fsDec(doc); p.sp = p.sp || []; fresh[p.id] = p; });
        pageToken = data.nextPageToken || '';
      } while (pageToken);
      PEOPLE = fresh;
      cacheSave(rev || Date.now(), PEOPLE);
    } catch (e) {
      if (cached?.people) {
        PEOPLE = cached.people;
        toast('تعذّر تحديث الشجرة — عُرضت آخر نسخة محفوظة في جهازك', 6000);
        return;
      }
      throw e;
    }
  },
  async savePerson(p, isNew) {
    const rec = { ...p }; delete rec.id; delete rec._doc;
    if (DEMO) {
      const d = demoLoad() || demoSeed(); d.people[p.id] = structuredClone(p); demoSave(d); return;
    }
    if (isNew) await fsReq('POST', `/ft_people?documentId=${p.id}`, fsEnc(rec));
    else await fsReq('PATCH', `/ft_people/${p.id}`, fsEnc(rec));
    scheduleRevBump();
  },
  async deletePerson(id) {
    if (DEMO) { const d = demoLoad() || demoSeed(); delete d.people[id]; demoSave(d); return; }
    await fsReq('DELETE', `/ft_people/${id}`);
    scheduleRevBump();
  },
  async addLog(action, pname, details) {
    const rec = { u: SESSION?.un || '؟', a: action, p: pname || '', d: details || '', ts: Date.now() };
    if (DEMO) { const d = demoLoad() || demoSeed(); (d.log = d.log || []).unshift(rec); d.log = d.log.slice(0, 500); demoSave(d); return; }
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
    if (DEMO) { const d = demoLoad() || demoSeed(); (d.comments = d.comments || []).unshift(rec); demoSave(d); return; }
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
  },
  /* نماذج التعبئة الذاتية */
  async addSub(pid, pn, by, j) {
    const rec = { pid, pn, by, j, ts: Date.now() };
    if (DEMO) { const d = demoLoad() || demoSeed(); (d.subs = d.subs || []).unshift(rec); demoSave(d); return; }
    await fsReq('POST', '/ft_subs', fsEnc(rec), true);
  },
  async listSubs() {
    if (DEMO) return (demoLoad()?.subs) || [];
    const out = [];
    let pageToken = '';
    do {
      const data = await fsReq('GET', `/ft_subs?pageSize=200${pageToken ? '&pageToken=' + pageToken : ''}`);
      (data.documents || []).forEach(doc => out.push(fsDec(doc)));
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out.sort((a, b) => b.ts - a.ts);
  },
  async deleteSub(id) {
    if (DEMO) { const d = demoLoad() || demoSeed(); d.subs = (d.subs || []).filter(s => s.id !== id && String(s.ts) !== String(id)); demoSave(d); return; }
    await fsReq('DELETE', `/ft_subs/${id}`);
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

/* ─────────── اتجاه العرض: عمودي أو أفقي ─────────── */
const LKEY = 'ft_layout';
let LAYOUT = localStorage.getItem(LKEY) === 'h' ? 'h' : 'v';
function applyLayout() {
  $('#canvas').classList.toggle('horiz', LAYOUT === 'h');
  const b = $('#btnLayout');
  if (b) {
    b.textContent = LAYOUT === 'h' ? '⇄ أفقي' : '⇅ عمودي';
    b.title = LAYOUT === 'h' ? 'العرض أفقي — اضغط للعمودي' : 'العرض عمودي — اضغط للأفقي';
  }
}
function toggleLayout() {
  LAYOUT = LAYOUT === 'h' ? 'v' : 'h';
  localStorage.setItem(LKEY, LAYOUT);
  applyLayout();
  requestAnimationFrame(fitView);
  toast(LAYOUT === 'h' ? 'العرض الأفقي: المؤسس يساراً وذريته تتفرع يميناً' : 'العرض العمودي: المؤسس أعلى وذريته تنزل تحته');
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

function nodeHTML(p, isRoot, depthLeft = Infinity) {
  const spouses = (p.sp || []).map(id => PEOPLE[id]).filter(Boolean);
  const kids = childrenOf(p);
  const contBadge = kids.length && depthLeft <= 1 ? '<div class="contb">⤵ فرعه في صفحةٍ مستقلة</div>' : '';

  /* تعدد الزوجات (أو الأزواج): كل زوجة رقاقةٌ رأسُ فرعٍ تحته أبناؤها */
  if (spouses.length >= 2) {
    const byMate = new Map(spouses.map(s => [s.id, []]));
    const rest = [];
    for (const k of kids) {
      const key = byMate.has(k.m) ? k.m : (byMate.has(k.f) ? k.f : null);
      if (key) byMate.get(key).push(k); else rest.push(k);
    }
    if (depthLeft <= 1) {
      return `<div class="branch${isRoot ? ' root' : ''}"><div class="punit">${cardHTML(p)}${spouses.map(spouseChipHTML).join('')}${contBadge}</div></div>`;
    }
    const mateBranches = spouses.map(s => {
      const sk = byMate.get(s.id);
      const skHTML = sk.length ? `<div class="kids">${sk.map(k => nodeHTML(k, false, depthLeft - 1)).join('')}</div>` : '';
      return `<div class="branch mate"><div class="punit">${spouseChipHTML(s)}</div>${skHTML}</div>`;
    }).join('');
    const restHTML = rest.map(k => nodeHTML(k, false, depthLeft - 1)).join('');
    return `<div class="branch${isRoot ? ' root' : ''}"><div class="punit">${cardHTML(p)}</div>
      <div class="kids">${mateBranches}${restHTML}</div></div>`;
  }

  /* زوجة واحدة أو بلا زواج: البطاقة والرقاقة تحتها والأبناء أسفلهما */
  const unit = `<div class="punit">${cardHTML(p)}${spouses.map(spouseChipHTML).join('')}${contBadge}</div>`;
  const kidsHTML = (kids.length && depthLeft > 1)
    ? `<div class="kids">${kids.map(k => nodeHTML(k, false, depthLeft - 1)).join('')}</div>` : '';
  return `<div class="branch${isRoot ? ' root' : ''}">${unit}${kidsHTML}</div>`;
}

function treeHTML(roots, depth = Infinity) {
  return `<div class="tree-root">${roots.map(r => nodeHTML(r, true, depth)).join('')}</div>`;
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
  applyLayout();
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
  /* العجلة: تكبير وتصغير حول موضع المؤشر (السلوك المعتمد) */
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.9, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  /* لوحة المفاتيح: الأسهم للتحريك، + و − للتكبير، 0 للملاءمة */
  window.addEventListener('keydown', e => {
    if (!$('#screen-app').classList.contains('on')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || $$('.overlay.on').length) return;
    const step = e.shiftKey ? 200 : 70;
    const keys = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [step, 0], ArrowRight: [-step, 0] };
    if (keys[e.key]) {
      e.preventDefault();
      VS.tx += keys[e.key][0]; VS.ty += keys[e.key][1];
      applyView();
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(0.83, vp.clientWidth / 2, vp.clientHeight / 2); }
    else if (e.key === '0') { e.preventDefault(); fitView(); }
  });

  $('#zin').onclick = () => zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2);
  $('#zout').onclick = () => zoomAt(0.83, vp.clientWidth / 2, vp.clientHeight / 2);
  $('#zfit').onclick = fitView;
  $('#zhelp').onclick = () => toast(
    'عجلة الماوس: تكبير وتصغير • السحب بالماوس أو الإصبع: تحريك الشجرة • قرصة الأصابع: تكبير • الأسهم للتحريك و + − للتكبير و ٠ للملاءمة',
    7000);
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
    males.map(p => `<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${esc(personLabel(p, { year: true }))}</option>`).join('');
}
function motherOptions(selected, excludeId, fatherId) {
  const opt = p => `<option value="${p.id}" ${selected === p.id ? 'selected' : ''}>${esc(personLabel(p, { year: true }))}</option>`;
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
  fillMonths('#pfBMon', 'h');
  $('#pfBirth').value = p?.byh || '';
  $('#pfBMon').value = p?.bm || '';
  $('#pfBDay').value = p?.bd || '';
  $('#pfBirthHint').textContent = '';
  $('#pfMar').checked = !!p?.mar || FORM.spList.length > 0;
  $('#pfDead').checked = !!p?.dead;
  setSeg('#pfDCal', 'h');
  fillMonths('#pfDMon', 'h');
  $('#pfDeath').value = p?.dyh || '';
  $('#pfDMon').value = p?.dm || '';
  $('#pfDDay').value = p?.dd || '';
  $('#pfDeathHint').textContent = '';
  $('#pfOrd').value = p?.ord || '';
  $('#pfJob').value = p?.job || '';
  $('#pfBio').value = p?.bio || '';
  updateOrdHint();
  renderPhotoPrev();
  renderSpouseChips();
  toggleSub();
  $('#pfErr').textContent = '';
  closeModal('#mdView');
  openModal('#mdForm');
  setTimeout(() => $('#pfName').focus(), 50);
}

/* تعبئة قائمة الشهور حسب التقويم المختار */
function fillMonths(sel, cal) {
  const cur = $(sel).value;
  const names = cal === 'h' ? HMONTHS : GMONTHS;
  $(sel).innerHTML = `<option value="">— بلا شهر —</option>` +
    names.map((n, i) => `<option value="${i + 1}">${arD(i + 1)} — ${n}</option>`).join('');
  if (cur) $(sel).value = cur;
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
    chips.push(`<span class="spchip">⚭ ${esc(s ? personLabel(s, { depth: 1 }) : id)} <a data-rmsp="${id}">✕</a></span>`);
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
      cands.map(c => `<button type="button" class="btn btn-sm" data-lnk="${c.id}" style="margin:3px">🔗 ${esc(personLabel(c, { year: true }))}</button>`).join('')
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

/* يقرأ سنة/شهر/يوم بتقويم الإدخال ويُخرج التاريخ بالتقويمين */
function dateSet(yVal, mVal, dVal, cal) {
  const y = parseInt(yVal, 10) || 0;
  const m = parseInt(mVal, 10) || 0;
  const d = parseInt(dVal, 10) || 0;
  const out = { hy: 0, hm: 0, hd: 0, gy: 0, gm: 0, gd: 0 };
  if (!y) return out;
  if (cal === 'h') {
    out.hy = y; out.gy = h2g(y);
    if (m && d) {
      const g = hDateToG(y, m, d);
      if (g) { out.hm = m; out.hd = d; out.gy = g.y; out.gm = g.m; out.gd = g.d; }
    }
  } else {
    out.gy = y; out.hy = g2h(y);
    if (m && d) {
      const h = gDateToH(y, m, d);
      if (h) { out.gm = m; out.gd = d; out.hy = h.y; out.hm = h.m; out.hd = h.d; }
    }
  }
  return out;
}

async function submitPersonForm() {
  const name = $('#pfName').value.trim();
  if (!name) { $('#pfErr').textContent = 'الاسم مطلوب'; return; }
  const g = getSeg('#pfGender');
  const fSel = $('#pfFather').value;
  const root = fSel === '__root__';
  const f = root ? '' : fSel;
  const m = $('#pfMother').value;
  const b = dateSet($('#pfBirth').value, $('#pfBMon').value, $('#pfBDay').value, getSeg('#pfCal'));
  const dead = $('#pfDead').checked;
  const d = dead ? dateSet($('#pfDeath').value, $('#pfDMon').value, $('#pfDDay').value, getSeg('#pfDCal'))
                 : { hy: 0, hm: 0, hd: 0, gy: 0, gm: 0, gd: 0 };
  const mar = $('#pfMar').checked;

  const isNew = !FORM.editId;
  const id = FORM.editId || ('p_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
  const old = FORM.editId ? PEOPLE[FORM.editId] : null;

  const p = {
    id, n: name, g,
    byh: b.hy, byg: b.gy, bm: b.hm, bd: b.hd, bmg: b.gm, bdg: b.gd,
    dyh: d.hy, dyg: d.gy, dm: d.hm, dd: d.hd, dmg: d.gm, ddg: d.gd,
    dead, mar: mar || FORM.spList.length > 0 || FORM.newSpouses.length > 0,
    ph: FORM.photo || '',
    job: $('#pfJob').value.trim(),
    bio: $('#pfBio').value.trim(),
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
  rows.push(['الحالة', p.mar ? (p.g === 'f' ? 'متزوجة' : 'متزوج') : (p.g === 'f' ? 'عزباء' : 'أعزب')]);
  if (p.job) rows.push(['التخصص', esc(p.job)]);
  if (p.byh || p.byg) rows.push(['الميلاد', fullDateLabel(p, 'b')]);
  if (p.dead && (p.dyh || p.dyg)) rows.push(['الوفاة', fullDateLabel(p, 'd')]);
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
    ${p.bio ? `<div class="pv-bio"><b>📖 سيرته:</b><br>${esc(p.bio)}</div>` : ''}
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
  // رابط نموذج التعبئة الذاتية (للأدمنية) — يرسله الأدمن للفرد ليملأ أسرته
  const fl = $('#pvFormLink');
  fl.style.display = VIEW ? 'none' : '';
  fl.onclick = () => {
    const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'form.html?p=' + encodeURIComponent(id);
    const msg = `السلام عليكم ${p.n}\nهذا رابط خاص بك لتعبئة بيانات أسرتك في شجرة ${META?.familyName || 'العائلة'}:\n${url}`;
    const done = () => toast('نُسخت رسالة الرابط — أرسلها له في واتساب ✓', 4000);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(msg).then(done).catch(() => prompt('انسخ الرابط:', url));
    else prompt('انسخ الرابط:', url);
  };
  // نسخ رابط البطاقة المباشر (يفتح صفحة العرض العام على هذا الفرد)
  $('#pvShare').onclick = () => {
    const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'view.html?p=' + encodeURIComponent(id);
    const done = () => toast('نُسخ رابط بطاقته — شاركه مع العائلة ✓', 3500);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('انسخ الرابط:', url));
    else prompt('انسخ الرابط:', url);
  };
  // للزائر: «هذا أنا» → نموذج تعبئة أسرته
  const meBtn = $('#pvFillMe');
  meBtn.style.display = VIEW ? '' : 'none';
  meBtn.onclick = () => { location.href = 'form.html?p=' + encodeURIComponent(id) + (DEMO ? '&demo=1' : ''); };
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
      $('#bkWifeSugg').innerHTML = `<span class="hint">✓ «${esc(personLabel(p))}» مثبتة زوجةً وأماً للأبناء أدناه</span>`;
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

/* اسم مميِّز للقوائم: «فلان بن فلان بن فلان»، أو «فلانة (زوجة فلان)» لمن لا أب لها في الشجرة */
function personLabel(p, { depth = 2, year = false } = {}) {
  if (!p) return '';
  let s = p.n;
  let cur = p, first = true, n = 0;
  while (cur.f && PEOPLE[cur.f] && n < depth) {
    const fa = PEOPLE[cur.f];
    s += (first && p.g === 'f' ? ' بنت ' : ' بن ') + fa.n;
    first = false; cur = fa; n++;
  }
  if (!n) {
    if (p.root) s += ' ⭐';
    else {
      const sp = (p.sp || []).map(x => PEOPLE[x]).find(Boolean);
      if (sp) {
        const spFa = sp.f && PEOPLE[sp.f];
        s += ` (${p.g === 'f' ? 'زوجة' : 'زوج'} ${sp.n}${spFa ? ' بن ' + spFa.n : ''})`;
      }
    }
  }
  if (year && p.byh) s += ` — ${arD(p.byh)}هـ`;
  return s;
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
    males.map(p => `<option value="${p.id}">${esc(personLabel(p, { year: true }))}</option>`).join('') +
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
      cands.map(c => `<button type="button" class="btn btn-sm" data-wlnk="${c.id}" style="margin:2px">🔗 ${esc(personLabel(c, { year: true }))}</button>`).join('')
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
      <td><span class="dot ${dotCls}" style="display:inline-block;vertical-align:middle;margin-inline-end:6px"></span><b>${esc(p.n)}</b>${p.dead ? ' <span class="deadband">متوفى</span>' : ''}
        ${(() => { const lin = personLabel(p, { depth: 3 }).slice(p.n.length).trim(); return lin ? `<div class="muted" style="font-size:12.5px">${esc(lin)}</div>` : ''; })()}</td>
      <td class="muted">${father ? esc(personLabel(father, { depth: 1 })) : (p.root ? '⭐ مؤسس' : '—')}</td>
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

/* فتح بطاقة فرد من رابط مباشر: ?p=<id> */
function openFromParam() {
  const pid = new URLSearchParams(location.search).get('p');
  if (!pid || !PEOPLE[pid]) return;
  setTimeout(() => {
    const el = document.querySelector(`#canvas [data-id="${pid}"]`);
    if (el) { el.classList.add('hit'); centerOnEl(el); }
    openPersonView(pid);
  }, 450);
}

/* ─── إشعارات تلغرام للأدمن (إن فُعّلت في config) ─── */
const appBase = () => location.origin + location.pathname.replace(/[^/]*$/, '');

async function tgSend(msg) {
  const { TG_TOKEN, TG_CHAT } = FT_CONFIG;
  if (!TG_TOKEN || !TG_CHAT || DEMO) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, disable_web_page_preview: true })
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) console.warn('tg', d);
    return !!d.ok;
  } catch (e) { console.warn('tg', e); return false; }
}

/* إشعار اقتراح زائر */
async function notifyTelegram(who, text, tag) {
  return tgSend(`💬 اقتراح جديد على شجرة ${META?.familyName || 'العائلة'}\nمن: ${who}${tag ? `\nبخصوص: ${tag.name}` : ''}\n\n${text}\n\n${appBase()}`);
}

/* إشعار نموذج أسرة وارد — مفصّل */
async function notifySubTelegram(person, by, j) {
  const fam = META?.familyName || 'العائلة';
  const cal = j.cal === 'g' ? 'م' : 'هـ';
  const isUpd = [...(j.spouses || []), ...(j.kids || [])].some(x => x.id) || (j.removed || []).length;
  const L = [`📥 ${isUpd ? 'تحديث عائلة' : 'نموذج عائلة جديد'} — شجرة ${fam}`, `الفرد: ${person.n}`, `أرسله: ${by}`];
  if (j.self?.y || j.self?.job) {
    const bits = [];
    if (j.self.y) bits.push(`مواليد ${j.self.y}${j.self.m && j.self.d ? ` (${j.self.d}/${j.self.m})` : ''}${cal}`);
    if (j.self.job) bits.push(j.self.job);
    L.push(`بياناته: ${bits.join(' • ')}`);
  }
  const mk = e => e.id ? '' : ' ✨جديد';
  if (j.spouses?.length) L.push(`\n${person.g === 'm' ? 'الزوجات' : 'الزوج'} (${j.spouses.length}):\n` + j.spouses.map(s => `• ${s.n}${s.dead ? ' (ت)' : ''}${s.y ? ` — ${s.y}${cal}` : ''}${mk(s)}`).join('\n'));
  if (j.kids?.length) L.push(`\nالأبناء (${j.kids.length}):\n` + j.kids.map(k => `${k.g === 'm' ? '•' : '◦'} ${k.n}${k.y ? ` — ${k.y}${cal}` : ''}${(k.mi >= 0 && j.spouses[k.mi]) ? ` (أمه ${j.spouses[k.mi].n})` : ''}${mk(k)}`).join('\n'));
  if (j.removed?.length) L.push(`\n⚠️ طلب إزالة: ${j.removed.map(r => r.n).join('، ')}`);
  if (j.note) L.push(`\n📝 ملاحظة: ${j.note}`);
  L.push(`\n👈 للاعتماد: افتح التطبيق ← «📥 النماذج»\n${appBase()}`);
  return tgSend(L.join('\n'));
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
    .map(p => `<option value="${p.id}">${esc(personLabel(p, { year: true }))}</option>`).join('');
  $('#expPerson').innerHTML = opts;
  $('#expPersonRow').style.display = 'none';
  setSeg('#expScope', 'all');
  openModal('#mdExport');
}
function doExport(personId, forceSplit = false) {
  const scopeAll = !personId;
  let roots;
  if (scopeAll) {
    roots = Object.values(PEOPLE).filter(p => p.root).sort((a, b) => (a.ord || 99) - (b.ord || 99));
  } else {
    roots = [PEOPLE[personId]];
  }
  if (!roots.length || !roots[0]) { toast('لا يوجد ما يُصدَّر'); return; }
  const famName = META?.familyName || 'العائلة';
  const baseTitle = scopeAll ? `شجرة ${famName}` : `شجرة ${famName} — فرع ${roots[0].n}`;
  const totalCount = scopeAll ? Object.keys(PEOPLE).length : countBranch(roots[0]);
  const pa = $('#printArea');

  // إظهار مؤقت خارج الشاشة للقياس الصحيح
  pa.style.cssText = 'display:block;position:fixed;left:-100000px;top:0';

  // هل تكفي صفحة واحدة بمقروئية جيدة؟
  pa.innerHTML = `<div class="ptree${LAYOUT === 'h' ? ' horiz' : ''}">${treeHTML(roots)}</div>`;
  const probe = pa.querySelector('.ptree');
  const fullZoom = Math.min(1, 1020 / (probe.scrollWidth || 1), 600 / (probe.scrollHeight || 1));

  const sheets = [];
  if (!forceSplit && fullZoom >= 0.5) {
    sheets.push({ sub: '', html: treeHTML(roots) });
  } else {
    // صفحة نظرة عامة (جيلان) ثم صفحة لكل فرعٍ له ذرية
    sheets.push({ sub: 'النظرة العامة — الأجيال الأولى', html: treeHTML(roots, 2) });
    for (const r of roots) {
      for (const k of childrenOf(r)) {
        if (!childrenOf(k).length) continue;
        const fa = k.f && PEOPLE[k.f];
        sheets.push({ sub: `فرع ${k.n}${fa ? ' بن ' + fa.n : ''}`, html: treeHTML([k]) });
      }
    }
  }

  const today = fmtDate(Date.now());
  pa.innerHTML = sheets.map((s, i) => `
    <div class="psheet">
      <div class="phead2">
        <div class="pt">🌳 ${esc(baseTitle)}</div>
        ${s.sub ? `<div class="ps">${esc(s.sub)}</div>` : ''}
      </div>
      <div class="ptreewrap"><div class="ptree${LAYOUT === 'h' ? ' horiz' : ''}">${s.html}</div></div>
      <div class="pfoot2">
        <span>${arD(totalCount)} فرداً</span>
        <span class="plg">
          <span class="dot m"></span> ذكور
          <span class="dot f"></span> إناث
          <span class="dot s"></span> أزواج (نسب)
          <span class="dot d"></span> شريط أسود: متوفى
        </span>
        <span>${today} — صفحة ${arD(i + 1)} من ${arD(sheets.length)}</span>
      </div>
    </div>`).join('');

  // ملاءمة كل صفحة على حدة (عرضاً وارتفاعاً)
  pa.querySelectorAll('.psheet .ptree').forEach(t => {
    const w = t.scrollWidth || 1, h = t.scrollHeight || 1;
    t.style.zoom = Math.min(1, 1020 / w, 600 / h);
  });

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
const LOG_LABELS = { add: '➕ إضافة', edit: '✏️ تعديل', del: '🗑 حذف', admin_add: '👤 إضافة أدمن', admin_del: '👤 إزالة أدمن', backup: '💾 نسخة احتياطية', restore: '♻️ استعادة نسخة', sub_ok: '📥 اعتماد نموذج' };
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
    openFromParam();
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
  ['#fabAdminWrap', '#btnLog', '#btnAdmins', '#btnComments', '#btnSubs', '#btnReload'].forEach(s => { const el = $(s); if (el) el.style.display = 'none'; });
  $('#fabViewWrap').style.display = '';
  $('#btnLogout').textContent = '🔑 دخول الأدمنية';
  $('#btnLogout').onclick = () => location.href = 'index.html';
  $('#brandName').textContent = 'شجرة العائلة';
  $('#demoBadge').style.display = DEMO ? '' : 'none';
  busy(true);
  try {
    if (DEMO) META = (demoLoad() || demoSeed()).meta;
    else { try { const doc = await fsReq('GET', '/ft_meta/setup', null, true); META = fsDec(doc); } catch {} }
    if (META?.familyName) { $('#brandName').textContent = `شجرة ${META.familyName}`; document.title = `شجرة ${META.familyName}`; }
    await DB.loadPeople();
    renderTree();
    openFromParam();
    if (new URLSearchParams(location.search).has('pick')) setTimeout(openPickMe, 400);
  } catch (e) {
    toast('تعذّر تحميل الشجرة: ' + e.message, 5000);
  } finally { busy(false); }
}

/* ─────────── النسخ الاحتياطي والاستعادة (للمالك) ─────────── */
function downloadBackup() {
  const data = {
    app: 'familytree',
    familyName: META?.familyName || '',
    exported: Date.now(),
    people: Object.values(PEOPLE).map(p => { const c = { ...p }; delete c._doc; return c; })
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `شجرة-${META?.familyName || 'العائلة'}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  DB.addLog('backup', '', `نسخة احتياطية (${arD(data.people.length)} فرداً)`);
  toast(`نُزّلت النسخة الاحتياطية (${arD(data.people.length)} فرداً) ✓`);
}

async function restoreBackup(file) {
  if (SESSION.role !== 'owner') { toast('الاستعادة للأدمن الأكبر فقط'); return; }
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('الملف ليس نسخة صالحة'); return; }
  if (data?.app !== 'familytree' || !Array.isArray(data.people) || !data.people.length || !data.people.every(p => p.id && p.n && p.g)) {
    toast('الملف ليس نسخة احتياطية صالحة من هذا التطبيق'); return;
  }
  const curN = Object.keys(PEOPLE).length;
  const when = data.exported ? fmtDate(data.exported) : '؟';
  if (!confirm(`ستُستبدل الشجرة الحالية (${arD(curN)} فرداً) بمحتوى النسخة:\n${arD(data.people.length)} فرداً — بتاريخ ${when}\n\nمتأكد؟`)) return;
  if (!confirm('تأكيد أخير: الشجرة الحالية ستُحذف بالكامل وتحل النسخة محلها.')) return;
  busy(true);
  try {
    for (const id of Object.keys(PEOPLE)) await DB.deletePerson(id);
    PEOPLE = {};
    for (const p of data.people) {
      const rec = { ...p };
      delete rec._doc;
      rec.sp = rec.sp || [];
      await DB.savePerson(rec, true);
      PEOPLE[rec.id] = rec;
    }
    scheduleRevBump();
    await DB.addLog('restore', '', `استعادة نسخة ${when} (${arD(data.people.length)} فرداً)`);
    renderTree();
    closeModal('#mdAdmins');
    toast(`استُعيدت النسخة: ${arD(data.people.length)} فرداً ✓`, 5000);
  } catch (e) { toast('تعذّرت الاستعادة: ' + e.message, 6000); }
  finally { busy(false); }
}

/* ═══════════ نموذج التعبئة الذاتية (رابط الفرد) ═══════════ */
let FILLP = null;

/* «مَن أنت؟» — يختار الزائر نفسه من الشجرة ثم يملأ أسرته */
function openPickMe() {
  openModal('#mdPickMe');
  $('#pmSearch').value = '';
  renderPickMe('');
  setTimeout(() => $('#pmSearch').focus(), 60);
}
function renderPickMe(q) {
  q = (q || '').trim();
  const rows = Object.values(PEOPLE)
    .filter(p => !q || p.n.includes(q))
    .sort((a, b) => a.n.localeCompare(b.n, 'ar'))
    .slice(0, 80);
  if (!rows.length) { $('#pmList').innerHTML = '<div class="muted">لا نتائج — جرّب جزءاً من الاسم</div>'; return; }
  $('#pmList').innerHTML = rows.map(p => {
    const dot = bloodline(p) ? (p.g === 'm' ? 'm' : 'f') : 's';
    return `<button type="button" class="pmrow" data-me="${esc(p.id)}">
      <span class="dot ${dot}"></span>
      <b>${esc(personLabel(p, { depth: 3 }))}</b>
      <span class="muted">${p.byh ? arD(p.byh) + 'هـ' : ''}</span>
    </button>`;
  }).join('');
  $$('#pmList [data-me]').forEach(b => b.onclick = () => {
    location.href = 'form.html?p=' + encodeURIComponent(b.dataset.me) + (DEMO ? '&demo=1' : '');
  });
}

async function enterFill(pid) {
  $('#screen-login').style.display = 'none';
  $('#screen-fill').style.display = 'block';
  try {
    if (DEMO) { const d = demoLoad() || demoSeed(); META = d.meta; PEOPLE = structuredClone(d.people); }
    else {
      try { const doc = await fsReq('GET', '/ft_meta/setup', null, true); META = fsDec(doc); } catch {}
      const doc = await fsReq('GET', `/ft_people/${pid}`, null, true);
      const p = fsDec(doc); p.sp = p.sp || []; PEOPLE[p.id] = p;
      // نحمّل الشجرة أيضاً لعرض النسب (اختياري — نتجاهل الخطأ)
      try { await DB.loadPeople(); } catch {}
    }
  } catch {
    $('#fillSub').innerHTML = '⚠️ تعذّر تحميل البيانات — <a href="view.html?pick=1" style="color:var(--gold)">اختر اسمك من الشجرة</a>';
    return;
  }
  const p = PEOPLE[pid];
  if (!p) { $('#fillSub').innerHTML = '⚠️ لم نجد هذا الفرد — <a href="view.html?pick=1" style="color:var(--gold)">اختر اسمك من الشجرة</a>'; return; }
  FILLP = p;
  document.title = `نموذج أسرة ${p.n}`;
  $('#fillTitle').textContent = `أهلاً ${p.n}`;
  $('#fillSub').innerHTML = `<b>${esc(fullNasab(p))}</b><br>أكمل بيانات أسرتك في شجرة ${esc(META?.familyName || 'العائلة')}`;
  const male = p.g === 'm';
  $('#flSpTitle').textContent = male ? '٢) الزوجات' : '٢) الزوج';
  $('#flSpHint').textContent = male
    ? 'اكتب اسم كل زوجة في سطر — وإن كانت متوفاة علّم عليها.'
    : 'اكتب اسم زوجك (غالباً من خارج العائلة) — وإن كان متوفى علّم عليه.';
  $('#flSpAdd').style.display = male ? '' : 'none';
  $('#flBy').value = p.n;
  $('#flBY').value = p.byh || '';
  $('#flBM').value = p.bm || '';
  $('#flBD').value = p.bd || '';
  $('#flJob').value = p.job || '';
  $('#flBio').value = p.bio || '';
  setSeg('#flCal', 'h');
  fillMonths('#flBM', 'h');
  $('#flBM').value = p.bm || '';
  FILL_REMOVED = [];
  $('#flSpRows').innerHTML = '';
  $('#flKidRows').innerHTML = '';

  // ═══ تحميل الأسرة المسجّلة حالياً لتحديثها (لا إعادة إدخالها) ═══
  const spouses = (p.sp || []).map(id => PEOPLE[id]).filter(Boolean);
  spouses.forEach(s => flAddSp(s.n, s.dead, s.byh, s.id));
  if (male) flAddSp();                       // سطر فارغ لزوجة جديدة
  else if (!spouses.length) flAddSp();

  const kids = Object.values(PEOPLE)
    .filter(c => (male ? c.f : c.m) === p.id)
    .sort((a, b) => (a.ord || 99) - (b.ord || 99) || (a.byg || 9999) - (b.byg || 9999));
  kids.forEach(k => {
    const mi = spouses.findIndex(s => s.id === (male ? k.m : k.f));
    flAddKid(k.n, k.g, k.byh, mi, k.id);
  });
  for (let i = 0; i < (kids.length ? 2 : 3); i++) flAddKid();

  const known = spouses.length + kids.length;
  $('#fillIntro').innerHTML = known
    ? `<b>بيانات أسرتك المسجّلة ظاهرة أمامك</b> (${arD(spouses.length)} ${male ? 'زوجة' : 'زوج'} و${arD(kids.length)} من الأبناء) — صحّحها أو أكملها أو أضف الجديد، ثم أرسل التحديث.`
    : 'املأ ما تعرفه — وما لا تعرفه اتركه فارغاً. تصل بياناتك للأدمن ليعتمدها ويضيفها للشجرة.';
  $('#flSend').textContent = known ? '📨 إرسال التحديثات للأدمن' : '📨 إرسال البيانات للأدمن';
  flSyncMothers();
  $('#fillBody').style.display = '';
}

let FILL_REMOVED = [];

function flAddSp(name = '', dead = false, y = 0, id = '') {
  const male = FILLP?.g === 'm';
  if (!male && $('#flSpRows').children.length >= 1) return;
  const div = document.createElement('div');
  div.className = 'bkrow flsp' + (id ? ' known' : '');
  div.dataset.eid = id;
  div.innerHTML = `
    <input type="text" class="fl-n" placeholder="${male ? 'اسم الزوجة…' : 'اسم الزوج…'}" value="${esc(name)}">
    <label class="flchk"><input type="checkbox" class="fl-d" ${dead ? 'checked' : ''}> متوفى</label>
    <input type="number" class="fl-y" placeholder="سنة الميلاد" value="${y || ''}">
    <button type="button" class="bk-x" title="${id ? 'طلب حذفه من الشجرة' : 'حذف السطر'}">✕</button>`;
  div.querySelector('.bk-x').onclick = () => {
    if (id && !confirm(`إزالة «${name}» من نموذجك؟ سيصل الأدمن طلبٌ بمراجعتها.`)) return;
    if (id) FILL_REMOVED.push({ id, n: name, t: 'sp' });
    div.remove(); flSyncMothers();
  };
  div.querySelector('.fl-n').addEventListener('input', flSyncMothers);
  $('#flSpRows').appendChild(div);
  flSyncMothers();
}

function flAddKid(n = '', g = 'm', y = 0, mi = -1, id = '') {
  const div = document.createElement('div');
  div.className = 'bkrow flkid' + (id ? ' known' : '');
  div.dataset.eid = id;
  div.innerHTML = `
    <input type="text" class="fl-n" placeholder="اسم الابن/البنت…" value="${esc(n)}">
    <button type="button" class="fl-g btn btn-sm" data-g="${g === 'f' ? 'f' : 'm'}">${g === 'f' ? '👧 بنت' : '👦 ولد'}</button>
    <input type="number" class="fl-y" placeholder="سنة الميلاد" value="${y || ''}">
    <select class="fl-m" data-mi="${mi}"></select>
    <button type="button" class="bk-x" title="${id ? 'طلب حذفه من الشجرة' : 'حذف السطر'}">✕</button>`;
  div.querySelector('.fl-g').onclick = e => {
    const b = e.currentTarget, m = b.dataset.g === 'm';
    b.dataset.g = m ? 'f' : 'm';
    b.textContent = m ? '👧 بنت' : '👦 ولد';
  };
  div.querySelector('.bk-x').onclick = () => {
    if (id && !confirm(`إزالة «${n}» من نموذجك؟ سيصل الأدمن طلبٌ بمراجعته.`)) return;
    if (id) FILL_REMOVED.push({ id, n, t: 'kid' });
    div.remove();
  };
  div.querySelector('.fl-n').addEventListener('input', () => {
    const rows = $$('#flKidRows .flkid');
    if (rows[rows.length - 1] === div && div.querySelector('.fl-n').value.trim()) flAddKid();
  });
  $('#flKidRows').appendChild(div);
  flSyncMothers();
}

/* قائمة الأمهات في أسطر الأبناء = الزوجات المكتوبات */
function flSyncMothers() {
  const male = FILLP?.g === 'm';
  const names = $$('#flSpRows .flsp').map(r => r.querySelector('.fl-n').value.trim()).filter(Boolean);
  $$('#flKidRows .flkid').forEach(r => {
    const sel = r.querySelector('.fl-m');
    const want = sel.value !== '' ? sel.value : (sel.dataset.mi ?? '-1');
    sel.style.display = (male && names.length > 1) ? '' : 'none';
    sel.innerHTML = `<option value="-1">— الأم —</option>` +
      names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    sel.value = (want !== '' && names[+want]) ? want : '-1';
  });
}

async function submitFill() {
  const errEl = $('#flErr');
  errEl.textContent = '';
  const by = $('#flBy').value.trim();
  if (!by) { errEl.textContent = 'اكتب اسمك في خانة المرسِل'; return; }
  const spouses = $$('#flSpRows .flsp').map(r => ({
    id: r.dataset.eid || '',
    n: r.querySelector('.fl-n').value.trim(),
    dead: r.querySelector('.fl-d').checked,
    y: parseInt(r.querySelector('.fl-y').value, 10) || 0
  })).filter(s => s.n);
  const kids = $$('#flKidRows .flkid').map(r => ({
    id: r.dataset.eid || '',
    n: r.querySelector('.fl-n').value.trim(),
    g: r.querySelector('.fl-g').dataset.g,
    y: parseInt(r.querySelector('.fl-y').value, 10) || 0,
    mi: parseInt(r.querySelector('.fl-m').value, 10)
  })).filter(k => k.n);
  const self = {
    y: parseInt($('#flBY').value, 10) || 0,
    m: parseInt($('#flBM').value, 10) || 0,
    d: parseInt($('#flBD').value, 10) || 0,
    job: $('#flJob').value.trim(),
    bio: $('#flBio').value.trim()
  };
  const note = $('#flNote').value.trim();
  if (!spouses.length && !kids.length && !self.y && !self.job && !self.bio && !note && !FILL_REMOVED.length) {
    errEl.textContent = 'املأ شيئاً واحداً على الأقل قبل الإرسال'; return;
  }
  const data = { cal: getSeg('#flCal'), self, spouses, kids, note, removed: FILL_REMOVED };
  const payload = JSON.stringify(data);
  if (payload.length > 11500) { errEl.textContent = 'البيانات كثيرة جداً — أرسلها على دفعتين'; return; }
  busy(true);
  try {
    await DB.addSub(FILLP.id, FILLP.n, by.slice(0, 60), payload);
    await notifySubTelegram(FILLP, by, data);
    $('#fillBody').style.display = 'none';
    $('#fillDone').style.display = '';
    $('#fillTitle').textContent = 'تم الإرسال';
    $('#fillSub').textContent = '';
  } catch (e) { errEl.textContent = 'تعذّر الإرسال: ' + e.message; }
  finally { busy(false); }
}

/* ─── مراجعة النماذج واعتمادها (للأدمنية) ─── */
async function openSubsModal() {
  openModal('#mdSubs');
  $('#subsList').innerHTML = '<div class="muted">جارٍ التحميل…</div>';
  try {
    const list = await DB.listSubs();
    if (!list.length) { $('#subsList').innerHTML = '<div class="muted">لا نماذج واردة بعد — أرسل رابط النموذج لأفراد العائلة من بطاقاتهم.</div>'; return; }
    $('#subsList').innerHTML = list.map((s, i) => {
      let j = {}; try { j = JSON.parse(s.j); } catch {}
      const cal = j.cal === 'g' ? 'م' : 'هـ';
      const tag = e => e.id ? (PEOPLE[e.id] ? '<span class="upd">مسجَّل</span>' : '<span class="upd">؟</span>') : '<span class="newb">جديد</span>';
      const spH = (j.spouses || []).map(x => `<li>${tag(x)} ${esc(x.n)}${x.dead ? ' (ت)' : ''}${x.y ? ` — ${arD(x.y)}${cal}` : ''}</li>`).join('');
      const kdH = (j.kids || []).map(x => `<li>${tag(x)} ${x.g === 'm' ? '👦' : '👧'} ${esc(x.n)}${x.y ? ` — ${arD(x.y)}${cal}` : ''}${(x.mi >= 0 && j.spouses[x.mi]) ? ` <span class="muted">(أمه ${esc(j.spouses[x.mi].n)})</span>` : ''}</li>`).join('');
      const rmH = (j.removed || []).map(x => `<li>${esc(x.n)} <span class="muted">(${x.t === 'sp' ? 'زوج/زوجة' : 'ابن/بنت'})</span></li>`).join('');
      const isUpdate = [...(j.spouses || []), ...(j.kids || [])].some(x => x.id) || (j.removed || []).length;
      const exists = !!PEOPLE[s.pid];
      return `<div class="subcard">
        <div class="subhead">
          <span class="subkind ${isUpdate ? 'u' : 'n'}">${isUpdate ? '🔄 تحديث عائلة' : '➕ عائلة جديدة'}</span>
          <b>${esc(PEOPLE[s.pid] ? personLabel(PEOPLE[s.pid], { depth: 3 }) : (s.pn || '؟'))}</b>
          <span class="muted">— أرسله: ${esc(s.by)} • ${fmtDateTime(s.ts)}</span>
        </div>
        ${j.self && (j.self.y || j.self.job || j.self.bio) ? `<div class="subsec"><b>بياناته:</b> ${j.self.y ? `مواليد ${arD(j.self.y)}${j.self.m && j.self.d ? ` (${arD(j.self.d)}/${arD(j.self.m)})` : ''}${cal}` : ''} ${j.self.job ? ` • ${esc(j.self.job)}` : ''}${j.self.bio ? `<br><span class="muted">${esc(j.self.bio)}</span>` : ''}</div>` : ''}
        ${spH ? `<div class="subsec"><b>الأزواج:</b><ul>${spH}</ul></div>` : ''}
        ${kdH ? `<div class="subsec"><b>الأبناء:</b><ul>${kdH}</ul></div>` : ''}
        ${rmH ? `<div class="subsec" style="color:var(--danger)"><b>⚠️ طلب إزالتهم من الشجرة (راجعها بنفسك — لم تُحذف):</b><ul>${rmH}</ul></div>` : ''}
        ${j.note ? `<div class="subsec"><b>ملاحظة:</b> ${esc(j.note)}</div>` : ''}
        <div class="subfoot">
          ${exists ? `<button class="btn btn-primary btn-sm" data-apply="${i}">✅ اعتماد كما هو</button>
                      <button class="btn btn-sm" data-edit="${i}">✏️ مراجعة وتعديل قبل الاعتماد</button>` : `<span class="muted">⚠️ الفرد لم يعد في الشجرة</span>`}
          <button class="btn btn-danger btn-sm" data-dels="${i}">🗑 حذف الطلب</button>
        </div>
      </div>`;
    }).join('');
    $$('#subsList [data-apply]').forEach(b => b.onclick = () => applySub(list[+b.dataset.apply]));
    $$('#subsList [data-edit]').forEach(b => b.onclick = () => openSubEdit(list[+b.dataset.edit]));
    $$('#subsList [data-dels]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.dels];
      if (!confirm('حذف هذا الطلب؟')) return;
      busy(true);
      try { await DB.deleteSub(s.id || s.ts); openSubsModal(); }
      catch (e) { toast('تعذّر الحذف: ' + e.message); }
      finally { busy(false); }
    });
  } catch (e) {
    $('#subsList').innerHTML = `<div class="muted">تعذّر التحميل: ${esc(e.message)}</div>`;
  }
}

/* ─── مراجعة النموذج وتعديله قبل الاعتماد ─── */
let SUBEDIT = null;

function openSubEdit(sub) {
  let j;
  try { j = JSON.parse(sub.j); } catch { toast('بيانات الطلب تالفة'); return; }
  const p = PEOPLE[sub.pid];
  SUBEDIT = { sub, male: (p?.g || 'm') === 'm' };
  $('#seTitle').textContent = 'مراجعة نموذج قبل الاعتماد';
  $('#seWho').textContent = p ? personLabel(p, { depth: 2 }) : (sub.pn || '');
  $('#seSpTitle').textContent = SUBEDIT.male ? 'الزوجات' : 'الزوج';
  const cal = j.cal === 'g' ? 'g' : 'h';
  setSeg('#seCal', cal);
  fillMonths('#seBM', cal);
  $('#seBY').value = j.self?.y || '';
  $('#seBM').value = j.self?.m || '';
  $('#seBD').value = j.self?.d || '';
  $('#seJob').value = j.self?.job || '';
  $('#seBio').value = j.self?.bio || '';
  $('#seNote').textContent = j.note || '';
  $('#seNoteBox').style.display = j.note ? '' : 'none';
  $('#seSpRows').innerHTML = '';
  $('#seKidRows').innerHTML = '';
  SUBEDIT.removed = j.removed || [];
  (j.spouses || []).forEach(s => seAddSp(s.n, s.dead, s.y, s.id));
  (j.kids || []).forEach(k => seAddKid(k.n, k.g, k.y, k.mi, k.id));
  if (!(j.spouses || []).length) seAddSp();
  if (!(j.kids || []).length) seAddKid();
  seSyncMothers();
  $('#seErr').textContent = '';
  closeModal('#mdSubs');
  openModal('#mdSubEdit');
}

function seAddSp(name = '', dead = false, y = 0, id = '') {
  const div = document.createElement('div');
  div.className = 'serow sp' + (id ? ' known' : '');
  div.dataset.eid = id || '';
  div.innerHTML = `
    <input type="text" class="se-n" placeholder="${SUBEDIT?.male ? 'اسم الزوجة…' : 'اسم الزوج…'}" value="${esc(name)}">
    <label class="flchk"><input type="checkbox" class="se-d" ${dead ? 'checked' : ''}> متوفى</label>
    <input type="number" class="se-y" placeholder="الميلاد" value="${y || ''}">
    <button type="button" class="bk-x" title="حذف">✕</button>`;
  div.querySelector('.bk-x').onclick = () => { div.remove(); seSyncMothers(); };
  div.querySelector('.se-n').addEventListener('input', seSyncMothers);
  $('#seSpRows').appendChild(div);
  seSyncMothers();
}

function seAddKid(n = '', g = 'm', y = 0, mi = -1, id = '') {
  const div = document.createElement('div');
  div.className = 'serow kid' + (id ? ' known' : '');
  div.dataset.eid = id || '';
  div.innerHTML = `
    <input type="text" class="se-n" placeholder="اسم الابن/البنت…" value="${esc(n)}">
    <button type="button" class="se-g btn btn-sm" data-g="${g === 'f' ? 'f' : 'm'}">${g === 'f' ? '👧 بنت' : '👦 ولد'}</button>
    <input type="number" class="se-y" placeholder="الميلاد" value="${y || ''}">
    <select class="se-m" data-mi="${mi}"></select>
    <button type="button" class="bk-x" title="حذف">✕</button>`;
  div.querySelector('.se-g').onclick = e => {
    const b = e.currentTarget, m = b.dataset.g === 'm';
    b.dataset.g = m ? 'f' : 'm';
    b.textContent = m ? '👧 بنت' : '👦 ولد';
  };
  div.querySelector('.bk-x').onclick = () => div.remove();
  $('#seKidRows').appendChild(div);
  seSyncMothers();
}

function seSyncMothers() {
  const names = $$('#seSpRows .sp').map(r => r.querySelector('.se-n').value.trim()).filter(Boolean);
  $$('#seKidRows .kid').forEach(r => {
    const sel = r.querySelector('.se-m');
    const want = sel.value !== '' ? sel.value : (sel.dataset.mi ?? '-1');
    sel.innerHTML = `<option value="-1">— الأم —</option>` +
      names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    sel.value = (want !== '' && names[+want]) ? want : '-1';
    sel.style.display = names.length > 1 ? '' : 'none';
  });
}

function seCollect() {
  return {
    cal: getSeg('#seCal'),
    self: {
      y: parseInt($('#seBY').value, 10) || 0,
      m: parseInt($('#seBM').value, 10) || 0,
      d: parseInt($('#seBD').value, 10) || 0,
      job: $('#seJob').value.trim(),
      bio: $('#seBio').value.trim()
    },
    spouses: $$('#seSpRows .sp').map(r => ({
      id: r.dataset.eid || '',
      n: r.querySelector('.se-n').value.trim(),
      dead: r.querySelector('.se-d').checked,
      y: parseInt(r.querySelector('.se-y').value, 10) || 0
    })).filter(s => s.n),
    kids: $$('#seKidRows .kid').map(r => ({
      id: r.dataset.eid || '',
      n: r.querySelector('.se-n').value.trim(),
      g: r.querySelector('.se-g').dataset.g,
      y: parseInt(r.querySelector('.se-y').value, 10) || 0,
      mi: parseInt(r.querySelector('.se-m').value, 10)
    })).filter(k => k.n),
    removed: SUBEDIT?.removed || [],
    note: $('#seNote').textContent || ''
  };
}

async function applySubEdited() {
  if (!SUBEDIT) return;
  const j = seCollect();
  if (!j.spouses.length && !j.kids.length && !j.self.y && !j.self.job && !j.self.bio) {
    $('#seErr').textContent = 'لا شيء لاعتماده — أضف بياناً واحداً على الأقل أو احذف الطلب'; return;
  }
  closeModal('#mdSubEdit');
  await applySub({ ...SUBEDIT.sub, j: JSON.stringify(j) }, true);
  SUBEDIT = null;
}

async function applySub(s, edited = false) {
  const p = PEOPLE[s.pid];
  if (!p) { toast('الفرد لم يعد موجوداً في الشجرة'); return; }
  let j; try { j = JSON.parse(s.j); } catch { toast('بيانات الطلب تالفة'); return; }
  const cal = j.cal === 'g' ? 'g' : 'h';
  const nNew = (j.spouses || []).length + (j.kids || []).length;
  if (!confirm(`اعتماد نموذج «${p.n}»${edited ? ' (بعد تعديلك)' : ''}؟\nسيُضاف ما لم يكن موجوداً: ${arD(nNew)} فرداً، وتُحدَّث بياناته.`)) return;
  busy(true);
  try {
    // ١) بياناته هو
    let changed = false;
    if (j.self?.y) {
      const ds = dateSet(j.self.y, j.self.m, j.self.d, cal);
      Object.assign(p, { byh: ds.hy, byg: ds.gy, bm: ds.hm, bd: ds.hd, bmg: ds.gm, bdg: ds.gd });
      changed = true;
    }
    if (j.self?.job) { p.job = j.self.job; changed = true; }
    if (j.self?.bio) { p.bio = j.self.bio; changed = true; }

    // ٢) الأزواج: تحديث المسجّل (بالمعرّف أو الاسم) وإنشاء الجديد
    const spIds = [];
    let updatedSp = 0;
    for (const sp of (j.spouses || [])) {
      let ex = sp.id && PEOPLE[sp.id] ? PEOPLE[sp.id] : null;
      if (ex) {   // تحديث بيانات زوجٍ مسجّل من النموذج
        let ch = false;
        if (sp.n && sp.n !== ex.n) { ex.n = sp.n; ch = true; }
        if (typeof sp.dead === 'boolean' && sp.dead !== ex.dead) { ex.dead = sp.dead; ch = true; }
        if (sp.y && sp.y !== (cal === 'h' ? ex.byh : ex.byg)) {
          const ys = dateSet(sp.y, 0, 0, cal);
          ex.byh = ys.hy; ex.byg = ys.gy; ch = true;
        }
        if (ch) { ex.ub = SESSION.un; ex.ut = Date.now(); await DB.savePerson(ex, false); updatedSp++; }
      }
      if (!ex) ex = Object.values(PEOPLE).find(x => x.n === sp.n && x.g !== p.g && (x.sp || []).includes(p.id));
      if (!ex) ex = Object.values(PEOPLE).find(x => x.n === sp.n && x.g !== p.g && !(x.sp || []).length && !x.f);
      if (ex) {
        spIds.push(ex.id);
        if (!(ex.sp || []).includes(p.id)) { ex.sp = [...(ex.sp || []), p.id]; ex.mar = true; ex.ub = SESSION.un; ex.ut = Date.now(); await DB.savePerson(ex, false); }
      } else {
        const y = sp.y ? dateSet(sp.y, 0, 0, cal) : null;
        const nid = newId();
        const rec = {
          id: nid, n: sp.n, g: p.g === 'm' ? 'f' : 'm',
          byh: y ? y.hy : 0, byg: y ? y.gy : 0, bm: 0, bd: 0, bmg: 0, bdg: 0,
          dyh: 0, dyg: 0, dm: 0, dd: 0, dmg: 0, ddg: 0,
          dead: !!sp.dead, mar: true, ph: '', job: '', bio: '',
          f: '', m: '', sp: [p.id], root: false, ord: 0,
          cb: SESSION.un, ub: '', ct: Date.now(), ut: 0
        };
        await DB.savePerson(rec, true);
        PEOPLE[nid] = rec;
        spIds.push(nid);
      }
      if (!(p.sp || []).includes(spIds[spIds.length - 1])) { p.sp = [...(p.sp || []), spIds[spIds.length - 1]]; p.mar = true; changed = true; }
    }

    // ٣) الأبناء (تخطّي المسجّل مسبقاً بنفس الاسم)
    const male = p.g === 'm';
    const spouseId = spIds[0] || (p.sp || [])[0] || '';
    let ord = Object.values(PEOPLE).filter(c => (male ? c.f : c.m) === p.id).length;
    let added = 0, updated = 0;
    for (const k of (j.kids || [])) {
      // تحديث ابنٍ مسجّل مسبقاً
      const cur = k.id && PEOPLE[k.id] ? PEOPLE[k.id] : null;
      if (cur) {
        let ch = false;
        if (k.n && k.n !== cur.n) { cur.n = k.n; ch = true; }
        if (k.g && k.g !== cur.g) { cur.g = k.g; ch = true; }
        if (k.y && k.y !== (cal === 'h' ? cur.byh : cur.byg)) {
          const ys = dateSet(k.y, 0, 0, cal);
          cur.byh = ys.hy; cur.byg = ys.gy; ch = true;
        }
        const wantM = male ? ((k.mi >= 0 && spIds[k.mi]) ? spIds[k.mi] : cur.m) : p.id;
        if (wantM && wantM !== cur.m) { cur.m = wantM; ch = true; }
        if (ch) { cur.ub = SESSION.un; cur.ut = Date.now(); await DB.savePerson(cur, false); updated++; }
        continue;
      }
      const dup = Object.values(PEOPLE).find(c => c.n === k.n && ((male ? c.f : c.m) === p.id));
      if (dup) continue;
      const y = k.y ? dateSet(k.y, 0, 0, cal) : null;
      const motherId = male ? ((k.mi >= 0 && spIds[k.mi]) ? spIds[k.mi] : (spIds[0] || '')) : p.id;
      const fatherId = male ? p.id : (spouseId || '');
      ord++; added++;
      const nid = newId();
      const rec = {
        id: nid, n: k.n, g: k.g === 'f' ? 'f' : 'm',
        byh: y ? y.hy : 0, byg: y ? y.gy : 0, bm: 0, bd: 0, bmg: 0, bdg: 0,
        dyh: 0, dyg: 0, dm: 0, dd: 0, dmg: 0, ddg: 0,
        dead: false, mar: false, ph: '', job: '', bio: '',
        f: fatherId, m: motherId, sp: [], root: false, ord,
        cb: SESSION.un, ub: '', ct: Date.now(), ut: 0
      };
      await DB.savePerson(rec, true);
      PEOPLE[nid] = rec;
    }

    if (changed) { p.ub = SESSION.un; p.ut = Date.now(); await DB.savePerson(p, false); }
    updated += updatedSp;
    await DB.addLog('sub_ok', p.n,
      `اعتماد نموذج أرسله ${s.by}${edited ? ' — بعد تعديل الأدمن' : ''} (${arD(added)} إضافة، ${arD(updated)} تحديث)`);
    await DB.deleteSub(s.id || s.ts);
    renderTree();
    openSubsModal();
    toast(`اعتُمد نموذج «${p.n}» — ${arD(added)} إضافة و${arD(updated)} تحديث ✓`, 5000);
  } catch (e) {
    toast('تعذّر الاعتماد: ' + e.message, 6000);
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
    const tag = CMT_TAG;
    await DB.addComment(name.slice(0, 60), text, tag);
    notifyTelegram(name, text, tag);
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
  $('#btnLayout').onclick = toggleLayout;
  $('#btnSubs').onclick = openSubsModal;
  $('#seSpAdd').onclick = () => seAddSp();
  $('#seKidAdd').onclick = () => seAddKid();
  $('#seApply').onclick = applySubEdited;
  $('#seCancel').onclick = () => { closeModal('#mdSubEdit'); openSubsModal(); };
  $$('#seCal button').forEach(b => b.onclick = () => { setSeg('#seCal', b.dataset.v); fillMonths('#seBM', b.dataset.v); });
  $('#fabFill').onclick = openPickMe;
  $('#pmSearch').addEventListener('input', e => renderPickMe(e.target.value));
  // نموذج التعبئة الذاتية
  $('#flSpAdd').onclick = () => flAddSp();
  $('#flKidAdd').onclick = () => flAddKid();
  $('#flSend').onclick = submitFill;
  $$('#flCal button').forEach(b => b.onclick = () => { setSeg('#flCal', b.dataset.v); fillMonths('#flBM', b.dataset.v); });
  $('#btnPeople').onclick = openPeopleModal;
  $('#plSearch').addEventListener('input', e => renderPeopleList(e.target.value));
  $('#fabComment').onclick = () => { CMT_TAG = null; renderCmtTag(); $('#cmErr').textContent = ''; openModal('#mdComment'); setTimeout(() => $('#cmName').focus(), 50); };
  $('#cmSend').onclick = submitComment;
  $('#pfFather').addEventListener('change', () => {
    const cur = $('#pfMother').value;
    $('#pfMother').innerHTML = motherOptions(cur, FORM?.editId, $('#pfFather').value);
    updateOrdHint();
  });
  $('#btnReload').onclick = async () => {
    busy(true);
    try { await DB.loadPeople(true); renderTree(); toast(`حُدّثت الشجرة — ${arD(Object.keys(PEOPLE).length)} فرداً`); }
    catch (e) { toast('تعذّر التحديث: ' + e.message, 6000); }
    finally { busy(false); }
  };
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
  $$('#pfCal button').forEach(b => b.onclick = () => { setSeg('#pfCal', b.dataset.v); fillMonths('#pfBMon', b.dataset.v); updateBirthHint(); });
  $$('#pfDCal button').forEach(b => b.onclick = () => { setSeg('#pfDCal', b.dataset.v); fillMonths('#pfDMon', b.dataset.v); updateDeathHint(); });
  ['#pfBMon', '#pfBDay'].forEach(s => $(s).addEventListener('input', updateBirthHint));
  ['#pfDMon', '#pfDDay'].forEach(s => $(s).addEventListener('input', updateDeathHint));
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

  // النسخ الاحتياطي
  $('#bkpDl').onclick = downloadBackup;
  $('#bkpRestore').onclick = () => $('#bkpFile').click();
  $('#bkpFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) restoreBackup(f);
    e.target.value = '';
  });
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
  el.innerHTML = 'إخوته حالياً: ' + sibs.map(s => `<b>${s.ord ? arD(s.ord) : '؟'}</b> ${esc(s.n)}${s.byh ? ` (${arD(s.byh)}هـ)` : ''}`).join('، ') +
    '<br>اتركه فارغاً فيُرتَّب تلقائياً بسنة ميلاده — وإن كتبت رقماً محجوزاً تزحزح مَن بعده تلقائياً';
}

/* معاينة حية للتحويل: التاريخ الكامل دقيق، والسنة وحدها تقريبية */
function dateHint(yEl, mEl, dEl, calSel) {
  const s = dateSet($(yEl).value, $(mEl).value, $(dEl).value, getSeg(calSel));
  if (!s.hy && !s.gy) return '';
  const exact = s.hm && s.hd;
  const other = getSeg(calSel) === 'h'
    ? (exact ? `${arD(s.gd)} ${GMONTHS[s.gm - 1]} ${arD(s.gy)}م` : `${arD(s.gy)}م تقريباً`)
    : (exact ? `${arD(s.hd)} ${HMONTHS[s.hm - 1]} ${arD(s.hy)}هـ` : `${arD(s.hy)}هـ تقريباً`);
  return `يوافق ${other}${exact ? ' ✓ (تحويل دقيق)' : ''}`;
}
function updateBirthHint() {
  $('#pfBirthHint').textContent = dateHint('#pfBirth', '#pfBMon', '#pfBDay', '#pfCal');
}
function updateDeathHint() {
  $('#pfDeathHint').textContent = dateHint('#pfDeath', '#pfDMon', '#pfDDay', '#pfDCal');
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
    else if (s === 'horiz') { if (LAYOUT !== 'h') toggleLayout(); }
    else if (s === 'subedit') {
      await DB.addSub('p3', 'محمد', 'محمد', JSON.stringify({
        cal: 'h',
        self: { y: 1360, m: 0, d: 0, job: 'تاجر أقمشة', bio: '' },
        spouses: [{ n: 'زينب', dead: false, y: 0 }, { n: 'شيخة', dead: false, y: 1372 }],
        kids: [{ n: 'سلمان', g: 'm', y: 1400, mi: 1 }, { n: 'حصة', g: 'f', y: 1404, mi: 1 }],
        note: 'أرجو التأكد من كتابة اسم شيخة'
      }));
      const l = await DB.listSubs();
      openSubEdit(l[0]);
    }
    else if (s === 'print' || s === 'printsplit') {
      window.print = () => {};
      doExport(null, s === 'printsplit');
      $('#screen-app').style.display = 'none';
      $('#printArea').style.cssText = 'display:block;position:static;background:#fff';
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
  if (FILL) { busy(true); try { await enterFill(FILL); } finally { busy(false); } return; }
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
