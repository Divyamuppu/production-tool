/* Neon backend for the a-tom. Production Pipeline.
   Talks to /api (Netlify Function → Neon Postgres). Same db / user / assets interface the app uses.
   Live updates: polls /api/changes every few seconds. */
(function () {
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function split(path) { var i = path.lastIndexOf("/"); return { col: path.slice(0, i), id: path.slice(i + 1) }; }
  function snap(rows) { return { docs: (rows || []).map(function (r) { return { id: r.id, data: function () { return r.data || {}; } }; }) }; }

  function create(cfg) {
    var API = (cfg.apiBase || "/api").replace(/\/$/, "");
    function call(path, body) {
      return fetch(API + path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401 && path.indexOf("/auth/") !== 0) { location.reload(); } if (!r.ok) { var e = err(r.status === 403 ? "not_granted" : "unavailable", j.error || r.statusText); e.body = j; throw e; } return j; }); });
    }

    // ---- live updates via polling ----
    var listeners = [], version = 0, timer = null, polling = false;
    function poll() {
      clearTimeout(timer);
      if (polling) return; polling = true;
      call("/changes?since=" + version).then(function (r) {
        var cols = r.cols || [];
        if (version && cols.length) listeners.forEach(function (l) { if (cols.indexOf(l.col) >= 0) l.pull(); });
        version = Math.max(version, r.v || 0);
      }).catch(function () {}).then(function () { polling = false; schedule(); });
    }
    function schedule() { clearTimeout(timer); if (listeners.length) timer = setTimeout(poll, document.hidden ? 15000 : 3000); }
    function nudge() { setTimeout(poll, 150); }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
    window.addEventListener("online", poll);

    function Query(col, f, o, l) { this.col = col; this.f = f || []; this.o = o || null; this.l = l || 0; }
    Query.prototype.where = function (k, op, v) { if (op !== "==") throw err("invalid_argument", "Only == is supported"); return new Query(this.col, this.f.concat([[k, v]]), this.o, this.l); };
    Query.prototype.orderBy = function (k, dir) { return new Query(this.col, this.f, [k, dir === "desc" ? "desc" : "asc"], this.l); };
    Query.prototype.limit = function (n) { return new Query(this.col, this.f, this.o, n); };
    Query.prototype.run = function () { return call("/query", { col: this.col, filters: this.f, order: this.o, limit: this.l }).then(function (r) { return r.rows || []; }); };
    Query.prototype.get = function () { return this.run().then(snap); };
    Query.prototype.onSnapshot = function (next, onErr) {
      var self = this, dead = false, l = { col: this.col, pull: function () { self.run().then(function (rows) { if (!dead) next(snap(rows)); }).catch(function (e) { if (!dead && onErr) onErr(e); }); } };
      listeners.push(l); l.pull();
      if (!version) poll(); else schedule();
      return function () { dead = true; listeners = listeners.filter(function (x) { return x !== l; }); };
    };

    function Doc(path) { this.path = path; }
    Doc.prototype.set = function (data) { return call("/set", { path: this.path, data: data }).then(nudge); };
    Doc.prototype.update = function (patch) {
      return call("/update", { path: this.path, patch: patch }).then(function (r) { nudge(); if (!r.found) throw err("invalid_argument", "Document does not exist"); });
    };
    Doc.prototype.delete = function () { return call("/delete", { path: this.path }).then(nudge); };

    var db = { collection: function (c) { return new Query(c); }, doc: function (p) { return new Doc(p); } };

    // Identity: a stable id per browser. Approver = whoever opened the link with ?approver=<code> once.
    var uid = localStorage.getItem("pp_uid");
    if (!uid) { uid = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem("pp_uid", uid); }
    var qs = new URLSearchParams(location.search), ap = qs.get("approver");
    if (ap !== null) {
      if (ap === "off") localStorage.removeItem("pp_approver"); else localStorage.setItem("pp_approver", ap);
      qs.delete("approver"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "") + location.hash);
    }
    var codeOwner = !!cfg.approverCode && localStorage.getItem("pp_approver") === cfg.approverCode;
    var meP = null;
    function whoami() { return meP || (meP = call("/auth/me").catch(function () { return { signedIn: false, required: false }; })); }
    var auth = {
      session: function () { return whoami().then(function (m) { return m.signedIn ? m : (m.required ? null : { anon: true }); }); },
      start: function (email, name, mode) { return call("/auth/start", { email: email, name: name || "", mode: mode }); },
      signOut: function () { return call("/auth/logout", {}).then(function () { localStorage.removeItem("pp_uid"); location.reload(); }); }
    };
    var user = {
      me: function () { return whoami().then(function (m) { return m.signedIn ? { id: m.id, email: m.email, name: "", avatarUrl: "", isOwner: !!m.isOwner || codeOwner } : { id: uid, name: "", avatarUrl: "", isOwner: codeOwner }; }); },
      can: function () { return Promise.resolve(true); },
      profiles: function () { return Promise.resolve({}); }
    };

    var assets = {
      upload: function (file, o) {
        var type = (o && o.type) || file.type || "application/octet-stream";
        if (file.size > 5.5 * 1048576) return Promise.reject(err("quota_or_state", "Files must be under 5.5 MB. Add bigger files as a link."));
        return fetch(API + "/upload", { method: "POST", headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(file.name || "file") }, body: file })
          .then(function (r) { if (!r.ok) throw err("unavailable"); return r.json(); })
          .then(function (j) { return { id: j.id, contentType: type, sizeBytes: file.size }; });
      },
      delete: function (key) { return fetch(API + "/file/" + encodeURIComponent(key), { method: "DELETE" }).then(function () {}); },
      url: function (key) { return API + "/file/" + encodeURIComponent(key); }
    };

    return { db: db, user: user, assets: assets, auth: auth };
  }

  window.PipelineNeon = { create: create };
})();
