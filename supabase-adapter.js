/* Supabase backend for the a-tom. Production Pipeline.
   Exposes the same db / user / assets interface the app already uses. */
(function () {
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function wrap(r) { if (r.error) throw err(/permission|policy|jwt/i.test(r.error.message || "") ? "not_granted" : "unavailable", r.error.message); return r.data; }
  function split(path) { var i = path.lastIndexOf("/"); return { col: path.slice(0, i), id: path.slice(i + 1) }; }
  function snap(rows) { return { docs: (rows || []).map(function (r) { return { id: r.id, data: function () { return r.data || {}; } }; }) }; }

  function create(cfg) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: false } });
    var T = "docs", BUCKET = cfg.bucket || "pipeline-files", chN = 0;

    function Query(col, filters, order, lim) { this.col = col; this.filters = filters || []; this.ord = order || null; this.lim = lim || 0; }
    Query.prototype.where = function (f, op, v) { if (op !== "==") throw err("invalid_argument", "Only == is supported"); return new Query(this.col, this.filters.concat([[f, v]]), this.ord, this.lim); };
    Query.prototype.orderBy = function (f, dir) { return new Query(this.col, this.filters, [f, dir], this.lim); };
    Query.prototype.limit = function (n) { return new Query(this.col, this.filters, this.ord, n); };
    Query.prototype.run = function () {
      var q = sb.from(T).select("id,data").eq("col", this.col);
      this.filters.forEach(function (f) { q = q.eq("data->>" + f[0], String(f[1])); });
      if (this.ord) q = q.order("data->>" + this.ord[0], { ascending: this.ord[1] !== "desc" });
      if (this.lim) q = q.limit(this.lim);
      return q.then(wrap);
    };
    Query.prototype.get = function () { return this.run().then(snap); };
    Query.prototype.onSnapshot = function (next, onErr) {
      var self = this, dead = false, t = null;
      function pull() { self.run().then(function (rows) { if (!dead) next(snap(rows)); }).catch(function (e) { if (!dead && onErr) onErr(e); }); }
      function soon() { clearTimeout(t); t = setTimeout(pull, 120); }
      var ch = sb.channel("pp" + (++chN))
        .on("postgres_changes", { event: "*", schema: "public", table: T, filter: "col=eq." + self.col }, soon)
        .subscribe(function (status) { if (status === "SUBSCRIBED") pull(); });
      pull();
      return function () { dead = true; clearTimeout(t); sb.removeChannel(ch); };
    };

    function Doc(path) { this.path = path; }
    Doc.prototype.set = function (data) {
      var p = split(this.path);
      return sb.from(T).upsert({ path: this.path, col: p.col, id: p.id, data: data, updated_at: new Date().toISOString() }).then(wrap);
    };
    Doc.prototype.update = function (patch) {
      return sb.rpc("doc_update", { p_path: this.path, p_patch: patch }).then(wrap).then(function (found) {
        if (!found) throw err("invalid_argument", "Document does not exist");
      });
    };

    var db = { collection: function (c) { return new Query(c); }, doc: function (p) { return new Doc(p); } };

    // Identity: a stable id per browser. Approver = whoever opened the link with ?approver=<code> once.
    var uid = localStorage.getItem("pp_uid");
    if (!uid) { uid = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem("pp_uid", uid); }
    var qs = new URLSearchParams(location.search), ap = qs.get("approver");
    if (ap !== null) {
      if (ap === "off") localStorage.removeItem("pp_approver"); else localStorage.setItem("pp_approver", ap);
      qs.delete("approver"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "") + location.hash);
    }
    var isOwner = !!cfg.approverCode && localStorage.getItem("pp_approver") === cfg.approverCode;
    var user = {
      me: function () { return Promise.resolve({ id: uid, name: "", avatarUrl: "", isOwner: isOwner }); },
      can: function () { return Promise.resolve(true); },
      profiles: function () { return Promise.resolve({}); }
    };

    var assets = {
      upload: function (file, o) {
        var name = String(file.name || "file").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);
        var key = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6) + "-" + name, type = (o && o.type) || file.type;
        return sb.storage.from(BUCKET).upload(key, file, { contentType: type, upsert: false }).then(wrap)
          .then(function () { return { id: key, contentType: type, sizeBytes: file.size }; });
      },
      delete: function (key) { return sb.storage.from(BUCKET).remove([key]).then(wrap); },
      url: function (key) { return sb.storage.from(BUCKET).getPublicUrl(key).data.publicUrl; }
    };

    return { db: db, user: user, assets: assets };
  }

  window.PipelineSupabase = { create: create };
})();
