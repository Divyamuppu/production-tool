/* Local backend: stores everything in this browser (localStorage) so the pipeline
   works with no server. Same db / user / assets interface as supabase-adapter.js.
   Syncs live across tabs of the same browser. Replace with Supabase for a shared team link. */
(function () {
  var KEY = "pp_local_db", listeners = [], chan = "BroadcastChannel" in window ? new BroadcastChannel("pp_local") : null;
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { throw err("quota_exceeded"); } }
  function split(path) { var i = path.lastIndexOf("/"); return { col: path.slice(0, i), id: path.slice(i + 1) }; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function merge(a, b) {
    var r = a && typeof a === "object" && !Array.isArray(a) ? a : {};
    Object.keys(b).forEach(function (k) {
      var v = b[k];
      if (v === null) delete r[k];
      else if (typeof v === "object" && !Array.isArray(v)) r[k] = merge(r[k], v);
      else r[k] = v;
    });
    return r;
  }
  function notify(col) { listeners.forEach(function (l) { if (l.col === col) l.fire(); }); }
  if (chan) chan.onmessage = function (e) { notify(e.data); };
  window.addEventListener("storage", function (e) { if (e.key === KEY) listeners.forEach(function (l) { l.fire(); }); });
  function changed(col) { notify(col); if (chan) chan.postMessage(col); }

  function Query(col, f, o, l) { this.col = col; this.f = f || []; this.o = o || null; this.l = l || 0; }
  Query.prototype.where = function (k, op, v) { return new Query(this.col, this.f.concat([[k, v]]), this.o, this.l); };
  Query.prototype.orderBy = function (k, dir) { return new Query(this.col, this.f, [k, dir], this.l); };
  Query.prototype.limit = function (n) { return new Query(this.col, this.f, this.o, n); };
  Query.prototype.rows = function () {
    var d = load(), col = this.col, self = this, out = [];
    Object.keys(d).forEach(function (p) {
      var s = split(p); if (s.col !== col) return;
      var x = d[p]; if (self.f.some(function (f) { return x[f[0]] !== f[1]; })) return;
      out.push({ id: s.id, data: x });
    });
    if (this.o) { var k = this.o[0], desc = this.o[1] === "desc"; out.sort(function (a, b) { var x = a.data[k], y = b.data[k]; return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); }); }
    if (this.l) out = out.slice(0, this.l);
    return out;
  };
  Query.prototype.snap = function () { return { docs: this.rows().map(function (r) { var c = clone(r.data); return { id: r.id, data: function () { return c; } }; }) }; };
  Query.prototype.get = function () { var self = this; return Promise.resolve().then(function () { return self.snap(); }); };
  Query.prototype.onSnapshot = function (next) {
    var self = this, t = null, l = { col: this.col, fire: function () { clearTimeout(t); t = setTimeout(function () { next(self.snap()); }, 30); } };
    listeners.push(l); l.fire();
    return function () { clearTimeout(t); listeners = listeners.filter(function (x) { return x !== l; }); };
  };

  function Doc(path) { this.path = path; }
  Doc.prototype.set = function (data) { var p = this.path; return Promise.resolve().then(function () { var d = load(); d[p] = clone(data); save(d); changed(split(p).col); }); };
  Doc.prototype.update = function (patch) {
    var p = this.path;
    return Promise.resolve().then(function () {
      var d = load(); if (!d[p]) throw err("invalid_argument", "Document does not exist");
      d[p] = merge(d[p], clone(patch)); save(d); changed(split(p).col);
    });
  };

  function create(cfg) {
    var uid = localStorage.getItem("pp_uid");
    if (!uid) { uid = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem("pp_uid", uid); }
    var qs = new URLSearchParams(location.search), ap = qs.get("approver");
    if (ap !== null) { localStorage.setItem("pp_approver", ap); qs.delete("approver"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "") + location.hash); }
    var apv = localStorage.getItem("pp_approver");
    var isOwner = apv === null ? true : apv !== "off" && (!cfg || !cfg.approverCode || apv === cfg.approverCode || apv === "on");
    var d = load();
    if (!Object.keys(d).some(function (p) { return p.indexOf("team/") === 0; })) {
      [["saksham", "Saksham", "Producer"], ["uthkarsha", "Uthkarsha", "Director"], ["swapnil", "Swapnil", "Research"], ["apoorv", "Apoorv", "Approver"]].forEach(function (m, i) {
        d["team/" + m[0]] = { id: m[0], name: m[1], role: m[2], email: "", userId: null, order: i };
      });
      save(d);
    }
    return {
      db: { collection: function (c) { return new Query(c); }, doc: function (p) { return new Doc(p); } },
      user: {
        me: function () { return Promise.resolve({ id: uid, name: "", avatarUrl: "", isOwner: isOwner }); },
        can: function () { return Promise.resolve(true); },
        profiles: function () { return Promise.resolve({}); }
      },
      assets: {
        upload: function (file, o) {
          if (file.size > 1.5 * 1048576) return Promise.reject(err("quota_or_state"));
          return new Promise(function (res, rej) {
            var r = new FileReader();
            r.onload = function () { var id = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); try { localStorage.setItem("pp_blob_" + id, r.result); } catch (e) { return rej(err("quota_or_state")); } res({ id: id, contentType: (o && o.type) || file.type, sizeBytes: file.size }); };
            r.onerror = function () { rej(err("unavailable")); };
            r.readAsDataURL(file);
          });
        },
        delete: function (id) { localStorage.removeItem("pp_blob_" + id); return Promise.resolve(); },
        url: function (id) { return localStorage.getItem("pp_blob_" + id) || ""; }
      },
      local: true
    };
  }
  window.PipelineLocal = { create: create };
})();
