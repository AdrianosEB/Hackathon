/* =============================================================
   CLAIM INTEGRITY — THE STORY
   =============================================================

   A scroll narrative over the existing API. It adds no endpoints
   and invents no data: every score, band and sentence comes back
   from /api/claims/analyze or /api/dashboard.

   Two things to keep honest as this file changes:

   1. The run scene must never animate progress it does not have.
      /api/claims/analyze answers once, at the end. Until it does,
      the rail sweeps and every row says it is waiting.

   2. A dropped file is read with FileReader in this browser and
      posted to the API on this machine. It is never sent anywhere
      else, and the page says so where the dropzone is.
============================================================= */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const money = (v) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(Number(v) || 0);

  /* blockingReason normally ends in a full stop; the sentence it is
     spliced into supplies its own, so drop the duplicate. */
  const stripStop = (text) => String(text || "").replace(/\s*\.\s*$/, "");

  const secs = (ms) => (Number(ms) / 1000).toFixed(1) + "s";


  /* ---- tone: four words, used everywhere ----
     confirmed and probable share a tone on purpose — both mean
     the record held up. How well is the gauge's job. */
  const LEVEL  = { routine: "clear", review: "watch", priority: "conflict" };
  const BAND   = { confirmed: "clear", probable: "clear",
                   incomplete: "unknown", conflicting: "conflict" };
  const DEC    = { auto_process: "clear", priority_review: "watch", hold: "conflict" };
  const CHECK  = { match: "clear", partial: "watch",
                   mismatch: "conflict", not_checked: "unknown" };
  const WEIGHT = { high: "conflict", medium: "watch", low: "unknown" };

  const bandTone = (band, blocking) => blocking ? "conflict" : (BAND[band] || "unknown");

  const scenarios = window.CLAIM_SCENARIOS || [];

  const state = { claim: null, source: null, running: false, result: null };


  // =============================================
  // BOOT
  //
  // Names the five stages of the pipeline. It reports that the
  // interface is ready — never that a registry has answered.
  // =============================================

  const BOOT = [
    "CLAIM RULES",
    "FEDERAL REGISTRY",
    "COVERAGE",
    "ROUTING",
    "OUTREACH"
  ];

  let booted = false;

  function finishBoot() {

    if (booted) return;
    booted = true;

    document.querySelectorAll("#bootList li").forEach((li) => li.classList.add("is-in"));
    $("boot").classList.add("is-gone");
    root.classList.remove("is-locked");
    startEngine();
  }


  async function boot() {

    const list = $("bootList");

    list.innerHTML = BOOT.map((label) =>
      `<li><span>${label}</span><b>READY</b></li>`).join("");

    // Nobody should be held at a splash they have already seen, and a
    // background tab throttles setTimeout to about a second a tick,
    // which would stretch this to six.
    addEventListener("pointerdown", finishBoot, { once: true });
    addEventListener("keydown", finishBoot, { once: true });

    if (reduced || document.hidden) {
      finishBoot();
      return;
    }

    for (const li of Array.from(list.children)) {
      if (booted) return;
      li.classList.add("is-in");
      await sleep(115);
    }

    await sleep(420);
    finishBoot();
  }


  // =============================================
  // THE SCROLL ENGINE
  //
  // One rAF loop, and one hard rule: paint() reads nothing from the
  // DOM. Every offset it needs is cached by measure(). The previous
  // version called offsetTop on each act every frame, which forced a
  // synchronous layout of a ten-thousand-pixel transformed wrapper
  // sixty times a second — that was the lag, not the animation.
  //
  // Elements are written to only when their value actually changes,
  // and will-change lives on the scroll wrapper alone. Putting it on
  // every animated element promotes each one to its own compositor
  // layer, which costs more than it saves.
  //
  // Engaged only for a fine pointer with motion allowed: inertia on
  // top of a touchscreen's own inertia feels broken.
  // =============================================

  const fine = matchMedia("(pointer: fine)").matches;
  const useLerp = !reduced && fine;
  const animate = !reduced;

  const root = document.documentElement;
  const scroller = $("scroll");

  let target = 0, smooth = 0, painted = -1;
  let vh = innerHeight, docH = 0;

  const parts = { rv: [], wipe: [], par: [], fade: [], split: [], pin: [] };
  let acts = [];


  function docTop(node) {
    let y = 0;
    for (let n = node; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  }

  function docLeft(node) {
    let x = 0;
    for (let n = node; n; n = n.offsetParent) x += n.offsetLeft;
    return x;
  }


  /* Splits a heading on its <br> into lines that can be masked
     individually. A line rides up from behind its own edge, which is
     a transform — cheap, and it reads far better than fading. */
  function sliceLines(el) {

    if (el.querySelector(".ln")) return;

    const lines = el.innerHTML.split(/<br\s*\/?>/i);

    el.innerHTML = lines.map((line) =>
      `<span class="ln"><span class="ln-i">${line.trim()}</span></span>`).join("");
  }


  function collect() {

    parts.rv = [];
    parts.wipe = [];
    parts.par = [];
    parts.fade = [];
    parts.split = [];
    parts.pin = [];

    document.querySelectorAll(".act:not([hidden])").forEach((act) => {
      Array.from(act.children).forEach((child, index) => {
        if (child.hasAttribute("data-par") || child.hasAttribute("data-pin")) return;
        child.classList.add("rv");
        parts.rv.push({ el: child, order: index, last: -1 });
      });
    });

    document.querySelectorAll("[data-anim='wipe']").forEach((el) => {
      sliceLines(el);
      Array.from(el.querySelectorAll(".ln-i")).forEach((line, index) => {
        parts.wipe.push({ el: line, order: index, last: -1 });
      });
    });

    document.querySelectorAll("[data-par]").forEach((el) =>
      parts.par.push({ el, speed: parseFloat(el.dataset.par) || 0, last: NaN }));

    document.querySelectorAll("[data-fade-out]").forEach((el) =>
      parts.fade.push({ el, last: -1 }));

    document.querySelectorAll("[data-split]").forEach((el) =>
      parts.split.push({ el, last: -1 }));

    document.querySelectorAll("[data-pin]").forEach((el) =>
      parts.pin.push({ el, last: NaN }));

    measure();
  }


  function measure() {

    vh = innerHeight;
    docH = scroller ? scroller.offsetHeight : document.body.scrollHeight;

    if (useLerp) document.body.style.height = `${docH}px`;

    for (const group of Object.values(parts)) {
      for (const item of group) {
        item.top = docTop(item.el);
        item.h = item.el.offsetHeight;
        item.reach = docH - item.top;
      }
    }

    // A pinned block is held still until its parent act has scrolled
    // through everything above its own last screenful.
    for (const item of parts.pin) {
      const act = item.el.closest(".act");
      item.range = Math.max(0, (act ? act.offsetHeight : item.h) - item.h);
      item.off = innerWidth <= 940 ? 0 : 1;     // no pinning on a phone
    }

    // Cached so the scene tag costs nothing per frame.
    acts = Array.from(document.querySelectorAll(".act:not([hidden])")).map((act) => ({
      top: docTop(act),
      tag: `SCENE ${act.dataset.act} · ${act.dataset.title}`
    }));

    Field.place();
    painted = -1;
  }


  const clamp = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

  function enterP(item, offset) {

    // item.reach is how far this element's progress can still grow
    // before scrolling runs out. Anything in the last screenful has
    // less of it than the animation wants, and the stagger offset
    // eats into it too — which is why the closing headline used to
    // sit permanently half-arrived. Both the offset and the travel
    // are capped by what is actually reachable, so every element
    // finishes, however close to the bottom it sits.
    const off = Math.min(offset || 0, Math.max(0, item.reach - 40));
    const travel = Math.min(vh * 0.62, item.h + vh * 0.3, Math.max(1, item.reach - off));

    return clamp((smooth + vh - item.top - off) / travel);
  }


  let lastTag = "";

  function paint() {

    for (const item of parts.rv) {
      const p = +enterP(item, item.order * 44).toFixed(3);
      if (p !== item.last) { item.el.style.setProperty("--p", p); item.last = p; }
    }

    for (const item of parts.wipe) {
      const p = +enterP(item, 20 + item.order * 62).toFixed(3);
      if (p !== item.last) { item.el.style.setProperty("--p", p); item.last = p; }
    }

    for (const item of parts.par) {
      const y = +(((smooth + vh / 2) - (item.top + item.h / 2)) * item.speed).toFixed(1);
      if (y !== item.last) { item.el.style.setProperty("--y", `${y}px`); item.last = y; }
    }

    for (const item of parts.fade) {
      const o = +(1 - clamp(smooth / (vh * 0.85)) * 0.92).toFixed(3);
      if (o !== item.last) { item.el.style.setProperty("--o", o); item.last = o; }
    }

    for (const item of parts.split) {
      const p = +enterP(item, 0).toFixed(3);
      if (p !== item.last) { item.el.style.setProperty("--p", p); item.last = p; }
    }

    for (const item of parts.pin) {
      const y = item.off
        ? +Math.min(Math.max(smooth - item.top, 0), item.range).toFixed(2)
        : 0;
      if (y !== item.last) {
        item.el.style.transform = `translate3d(0, ${y}px, 0)`;
        item.last = y;
      }
    }

    const max = Math.max(1, docH - vh);
    $("progress").style.width = `${(clamp(smooth / max) * 100).toFixed(2)}%`;

    let tag = "SCENE 01 · OPENING";
    for (const act of acts) if (act.top - smooth <= vh * 0.34) tag = act.tag;
    if (tag !== lastTag) { $("sceneTag").textContent = tag; lastTag = tag; }
  }


  const TAU = 115;          // ms for the scroll gap to close to ~63%
  let lastFrame = 0;


  function tick(now) {

    const dt = lastFrame ? Math.min(now - lastFrame, 64) : 16;
    lastFrame = now;

    target = scrollY;

    if (useLerp) {
      smooth += (target - smooth) * (1 - Math.exp(-dt / TAU));
      if (Math.abs(target - smooth) < 0.06) smooth = target;
      scroller.style.transform = `translate3d(0, ${(-smooth).toFixed(2)}px, 0)`;
    } else {
      smooth = target;
    }

    // Nothing moved and nothing is hovering: skip the whole pass.
    if (smooth !== painted) { paint(); painted = smooth; }

    Fold.frame(now, smooth);
    Field.draw(now, smooth);

    requestAnimationFrame(tick);
  }


  function startEngine() {

    if (!animate) { Fold.frame(0, 0); Field.draw(0, 0); return; }

    root.classList.add("engine");
    if (useLerp) root.classList.add("lerp");

    collect();
    smooth = target = scrollY;
    paint();

    // Draw both structures once, so the page is correct at rest even
    // if rAF never runs (a background tab suspends it).
    Fold.frame(0, smooth);
    Field.draw(0, smooth);

    requestAnimationFrame(tick);

    addEventListener("resize", () => { Field.size(); measure(); paint(); });

    addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      lastFrame = 0;
      smooth = target = scrollY;
      measure();
      paint();
    });

    setTimeout(() => { Field.size(); measure(); }, 400);
  }


  function recollect() {
    if (!animate) return;
    collect();
    paint();
  }


  function scrollToEl(el) {
    const y = docTop(el);
    if (reduced) scrollTo(0, y);
    else scrollTo({ top: y, behavior: useLerp ? "auto" : "smooth" });
  }


  // =============================================
  // THE FOLD
  //
  // The opening image is a claim you cannot see inside. Scrolling
  // unwraps it into its net, and the six faces are the six stages
  // that actually run. It is scrubbed, not played: scroll back and
  // it folds shut.
  //
  // Driven from tick() rather than paint(), because the idle drift
  // is a function of time and paint() is skipped when the scroll
  // position has not moved.
  // =============================================

  const pinRange = () => (parts.pin[0] && parts.pin[0].off) ? parts.pin[0].range : 0;

  const Fold = (function () {

    let el = null, cap = null, lastPhase = -1;

    function frame(t, smoothY) {

      el = el || $("fold");
      cap = cap || $("foldCap");
      if (!el) return;

      // Opens across the distance the hero is actually held still for,
      // finishing with room to spare so it is seen fully open before
      // the scene releases. Falls back to a screenful before measure()
      // has run.
      const held = (pinRange() || innerHeight * 0.85) * 0.74;
      const open = clamp(smoothY / Math.max(held, 1));
      const fold = 1 - open;

      // The four sides let go first and the last face lays down
      // after them, so the box peels open rather than all six hinges
      // moving as one.
      const sides = clamp(open / 0.7);
      const back = clamp((open - 0.3) / 0.7);

      // Sealed, it drifts. Open, it settles flat so the net reads.
      const drift = Math.sin(t * 0.00042) * 15 + 20;

      el.style.setProperty("--a", `${((1 - sides) * 90).toFixed(2)}deg`);
      el.style.setProperty("--ab", `${((1 - back) * 90).toFixed(2)}deg`);
      el.style.setProperty("--fold", fold.toFixed(3));
      el.style.setProperty("--spin", `${(fold * drift).toFixed(2)}deg`);
      el.style.setProperty("--tilt", `${(-(6 + 12 * fold)).toFixed(2)}deg`);

      const phase = open > 0.55 ? 1 : 0;
      if (phase !== lastPhase && cap) {
        cap.textContent = phase
          ? "OPENED INTO SIX STAGES · EVERY ONE OF THEM RUNS ON EVERY CLAIM"
          : "A CLAIM, SEALED · SCROLL TO OPEN IT";
        lastPhase = phase;
      }
    }

    return { frame };

  })();


  // =============================================
  // THE FIELD
  //
  // Every claim already assessed, placed by its two axes: review
  // priority across, data confidence up. A line is drawn between two
  // claims when they were billed under the same NPI — so the clusters
  // on screen are real provider clusters, not decoration. That is the
  // one relationship in this data worth drawing, and it is exactly
  // what a person looking for a pattern would want to see.
  //
  // Nothing here is a physics simulation. The nodes sit where their
  // scores put them and breathe by a couple of pixels; moving them
  // any further would misplace real data for the sake of a nicer
  // picture.
  // =============================================

  const Field = (function () {

    const TONE = {
      clear: [74, 222, 128], watch: [251, 191, 36],
      conflict: [251, 113, 133], unknown: [129, 140, 248]
    };

    let canvas, ctx, W = 0, H = 0, dpr = 1;
    let nodes = [], hubs = [];
    const pad = { l: 56, r: 44, t: 44, b: 52 };

    let boxTop = 0, boxLeft = 0, parSpeed = 0, parTop = 0, parH = 0;

    const mouse = { x: -9999, y: -9999, on: false };
    let hoverNode = null, hoverHub = null;


    function size() {

      canvas = canvas || $("field");
      if (!canvas) return;

      W = canvas.clientWidth;
      H = canvas.clientHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);

      canvas.width = Math.max(1, W * dpr);
      canvas.height = Math.max(1, H * dpr);

      ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      boxLeft = docLeft(canvas);
      parTop = docTop(canvas);
      parH = canvas.offsetHeight;

      const layer = canvas.closest("[data-par]");
      parSpeed = layer ? (parseFloat(layer.dataset.par) || 0) : 0;

      place();
    }


    /* Pixel positions. A claim's score decides where it sits; the
       only thing added is a fan offset for claims that share an exact
       score, so a stack of five is five visible dots instead of one.
       Nothing drifts over time — the position IS the data. */
    function place() {

      if (!W) return;

      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

      for (const n of nodes) {
        const bx = pad.l + n.nx * iw;
        const by = pad.t + (1 - n.ny) * ih;
        n.x = bx + n.fx;
        n.y = by + n.fy;
      }

      for (const hub of hubs) {
        let sx = 0, sy = 0;
        for (const i of hub.members) { sx += nodes[i].x; sy += nodes[i].y; }
        hub.x = sx / hub.members.length;
        hub.y = sy / hub.members.length;
      }
    }


    function build(claims) {

      const usable = claims.filter((c) =>
        c.verification && c.verification.dataConfidenceScore != null);

      // Claims that share an exact score land on the same pixel. Fan
      // them onto a small ring so each one can be seen and picked,
      // rather than 5 dots hiding under 1 and the lines between them
      // collapsing to nothing.
      const stacks = new Map();
      for (const c of usable) {
        const key = `${c.reviewPriority}|${c.verification.dataConfidenceScore}`;
        if (!stacks.has(key)) stacks.set(key, []);
        stacks.get(key).push(c);
      }

      nodes = [];

      for (const group of stacks.values()) {

        const n = group.length;
        const r = n === 1 ? 0 : 6 + Math.min(n, 10) * 1.15;

        group.forEach((c, i) => {
          const v = c.verification;
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          nodes.push({
            id: c.id,
            nx: clamp((c.reviewPriority || 0) / 100),
            ny: clamp((v.dataConfidenceScore || 0) / 100),
            fx: r * Math.cos(angle),
            fy: r * Math.sin(angle),
            tone: v.blocking ? "conflict" : (BAND[v.confidenceBand] || "unknown"),
            npi: c.npi || `#${c.id}`,
            label: c.claimNumber,
            sub: `${c.reviewPriority}/100 · ${v.confidenceBand}`,
            stacked: n,
            x: 0, y: 0
          });
        });
      }

      // A provider with more than one claim gets a marker at the
      // centre of its claims, and each of its claims links to it.
      // Drawing every pair instead would mean 28 lines for one
      // provider, nearly all of them on top of each other.
      const byNpi = new Map();
      nodes.forEach((n, i) => {
        if (!byNpi.has(n.npi)) byNpi.set(n.npi, []);
        byNpi.get(n.npi).push(i);
      });

      hubs = [];
      for (const [npi, members] of byNpi) {
        if (members.length < 2) continue;
        const spread = new Set(members.map((i) => `${nodes[i].nx}|${nodes[i].ny}`)).size;
        hubs.push({ npi, members, spread, x: 0, y: 0 });
      }

      size();

      return {
        claims: nodes.length,
        positions: stacks.size,
        providers: hubs.length,
        links: hubs.reduce((sum, h) => sum + h.members.length, 0)
      };
    }


    function draw(t, smoothY) {

      if (!ctx || !W) return;

      const parY = ((smoothY + innerHeight / 2) - (parTop + parH / 2)) * parSpeed;
      boxTop = parTop - smoothY + parY;

      const mx = mouse.on ? mouse.x - boxLeft : -9999;
      const my = mouse.on ? mouse.y - boxTop : -9999;

      ctx.clearRect(0, 0, W, H);

      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      if (iw < 60 || ih < 60) return;

      // ---- what is under the pointer ----
      hoverNode = null; hoverHub = null;
      let best = 1e9;

      for (let i = 0; i < nodes.length; i++) {
        const d = Math.hypot(nodes[i].x - mx, nodes[i].y - my);
        if (d < 11 && d < best) { best = d; hoverNode = i; }
      }

      if (hoverNode === null) {
        for (let i = 0; i < hubs.length; i++) {
          const d = Math.hypot(hubs[i].x - mx, hubs[i].y - my);
          if (d < 14 && d < best) { best = d; hoverHub = i; }
        }
      }

      const wasOver = canvas.dataset.over === "1";
      const isOver = hoverNode !== null;
      if (isOver !== wasOver) canvas.dataset.over = isOver ? "1" : "0";

      // ---- grid and axes ----
      ctx.strokeStyle = "#16161C";
      ctx.lineWidth = 1;
      for (let v = 0; v <= 100; v += 25) {
        const gx = pad.l + (v / 100) * iw, gy = pad.t + ih - (v / 100) * ih;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(pad.l + iw, gy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, pad.t); ctx.lineTo(gx, pad.t + ih); ctx.stroke();
      }

      ctx.strokeStyle = "#2E2E38";
      ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ih); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ih); ctx.lineTo(pad.l + iw, pad.t + ih); ctx.stroke();

      ctx.fillStyle = "#4C4C56";
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText("100", pad.l - 27, pad.t + 4);
      ctx.fillText("0", pad.l - 27, pad.t + ih + 4);
      ctx.fillText("0", pad.l - 3, pad.t + ih + 20);
      ctx.fillText("100", pad.l + iw - 14, pad.t + ih + 20);

      // ---- spokes: each claim to its provider ----
      for (let h = 0; h < hubs.length; h++) {

        const hub = hubs[h];
        const live = hoverHub === h;

        for (const i of hub.members) {

          const n = nodes[i];
          const lit = live || hoverNode === i;
          const c = TONE[n.tone];

          const d = mouse.on
            ? Math.hypot((n.x + hub.x) / 2 - mx, (n.y + hub.y) / 2 - my) : 9999;
          const prox = mouse.on ? clamp(1 - d / 200) : 0;

          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${
            Math.min(0.1 + prox * 0.28 + (lit ? 0.5 : 0), 0.9)})`;
          ctx.lineWidth = lit ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(hub.x, hub.y);
          ctx.stroke();
        }
      }

      // ---- provider markers ----
      for (let h = 0; h < hubs.length; h++) {

        const hub = hubs[h];
        const live = hoverHub === h;
        const pulse = 1 + Math.sin(t * 0.0011 + h) * 0.05;
        const r = (7 + Math.min(hub.members.length, 10) * 0.75) * pulse;

        ctx.strokeStyle = live ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.3)";
        ctx.lineWidth = live ? 1.6 : 1;
        ctx.beginPath(); ctx.arc(hub.x, hub.y, r, 0, Math.PI * 2); ctx.stroke();
      }

      // ---- claims ----
      for (let i = 0; i < nodes.length; i++) {

        const n = nodes[i], c = TONE[n.tone];
        const d = mouse.on ? Math.hypot(n.x - mx, n.y - my) : 9999;
        const near = clamp(1 - d / 170);
        const lit = hoverNode === i;
        const r = 3.4 + near * 1.3 + (lit ? 2 : 0);

        ctx.globalAlpha = 0.09 + near * 0.15 + (lit ? 0.22 : 0);
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fill();

        ctx.globalAlpha = 0.6 + near * 0.4;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ---- label ----
      let text = null, lx = 0, ly = 0;

      if (hoverNode !== null) {
        const n = nodes[hoverNode];
        text = `${n.label}  ${n.sub}` + (n.stacked > 1 ? `  ·  ${n.stacked} share this score` : "");
        lx = n.x; ly = n.y;
      } else if (hoverHub !== null) {
        const hub = hubs[hoverHub];
        text = `NPI ${hub.npi}  ·  ${hub.members.length} claims` +
               (hub.spread > 1 ? `  ·  ${hub.spread} distinct scores` : "");
        lx = hub.x; ly = hub.y;
      }

      if (text) {
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        const w = ctx.measureText(text).width + 16;
        const bx = Math.min(Math.max(lx + 14, 4), W - w - 4);
        const by = Math.max(ly - 30, 4);

        ctx.fillStyle = "rgba(8,8,10,.94)";
        ctx.fillRect(bx, by, w, 22);
        ctx.strokeStyle = "#3A3A45"; ctx.lineWidth = 1;
        ctx.strokeRect(bx + .5, by + .5, w - 1, 21);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(text, bx + 8, by + 15);
      }
    }


    addEventListener("pointermove", (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true;
    }, { passive: true });

    addEventListener("pointerleave", () => { mouse.on = false; });

    let onPick = null;

    function bindClick(el) {
      el.addEventListener("click", () => {
        if (hoverNode !== null && onPick) onPick(nodes[hoverNode].id);
      });
    }

    return {
      build, size, place, draw, bindClick,
      setPick: (fn) => { onPick = fn; }
    };

  })();


  async function loadField() {

    let claims = [];

    try {
      const response = await fetch("/api/dashboard");
      claims = (await response.json()).claims || [];
    } catch (error) {
      $("fieldCap").textContent = "COULD NOT REACH THE API ON THIS MACHINE.";
      return;
    }

    const stats = Field.build(claims);

    Field.bindClick($("field"));
    Field.setPick(openClaim);

    $("fieldCap").innerHTML = stats.claims
      ? `${stats.claims} ASSESSED CLAIM${stats.claims === 1 ? "" : "S"} AT ${stats.positions} ` +
        `DISTINCT SCORE${stats.positions === 1 ? "" : "S"} · ` +
        `ACROSS: REVIEW PRIORITY · UP: DATA CONFIDENCE<br />` +
        `ONE DOT IS ONE CLAIM — CLAIMS SCORING IDENTICALLY ARE FANNED APART SO NONE HIDES ANOTHER<br />` +
        `${stats.providers} RING${stats.providers === 1 ? "" : "S"} — EACH MARKS A PROVIDER WITH MORE THAN ` +
        `ONE CLAIM, AT THE CENTRE OF ITS OWN`
      : "NO CLAIMS ASSESSED YET — THE AXES ARE EMPTY, WHICH IS THE HONEST PICTURE.";
  }


  // =============================================
  // UPLOAD
  // =============================================

  const SAMPLE = {
    claimNumber: "CLM-10429",
    providerName: "Riverbend Family Medicine",
    npi: "9000000015",
    practiceAddressLine1: "4120 SE Hawthorne Blvd",
    practiceCity: "Portland",
    practiceState: "OR",
    practicePhone: "503-555-0118",
    patientLabel: "Patient A",
    diagnosisCodes: ["J06.9"],
    clinicalNote: "Established patient seen for upper respiratory symptoms.",
    lineItems: [
      { code: "99213", description: "Office visit, established patient",
        serviceDate: "2026-08-14", units: 1, amount: 112.00 }
    ]
  };


  /* Checks the same things the server checks, so a bad file is
     rejected here with a specific reason rather than as a 400. */
  function validate(claim) {

    const problems = [];

    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      return ["The file must contain a single JSON object describing one claim."];
    }

    if (!String(claim.claimNumber || "").trim()) problems.push("claimNumber is missing.");
    if (!String(claim.providerName || "").trim()) problems.push("providerName is missing.");

    const npi = String(claim.npi || "").replace(/\D/g, "");
    if (npi && npi.length !== 10) problems.push("npi must be exactly 10 digits.");

    if (!Array.isArray(claim.lineItems) || claim.lineItems.length === 0) {
      problems.push("lineItems must be a non-empty array.");
    } else {
      claim.lineItems.forEach((item, i) => {
        if (!String(item?.code || "").trim()) problems.push(`lineItems[${i}].code is missing.`);
        if (!(Number(item?.amount) >= 0)) problems.push(`lineItems[${i}].amount must be a number.`);
      });
    }

    return problems;
  }


  function showError(message) {
    $("dropError").textContent = message;
    $("dropError").hidden = false;
    $("parsed").hidden = true;
    $("runBtn").disabled = true;
    state.claim = null;
  }


  function accept(claim, source) {

    const problems = validate(claim);

    if (problems.length) {
      showError(`That file is not a claim this API can assess — ${problems.join(" ")}`);
      return;
    }

    state.claim = claim;
    state.source = source;
    $("dropError").hidden = true;

    const lines = claim.lineItems;
    const billed = lines.reduce(
      (sum, l) => sum + Number(l.amount || 0) * Number(l.units || 1), 0);

    $("parsed").innerHTML = `
      <div class="parsed-head">
        <strong>${esc(claim.claimNumber)} · ${esc(claim.providerName)}</strong>
        <span>READY</span>
      </div>
      <div class="parsed-rows">
        <div><span>SOURCE</span><b>${esc(source)}</b></div>
        <div><span>NPI</span><b>${esc(claim.npi || "none")}</b></div>
        <div><span>LINE ITEMS</span><b>${lines.length}</b></div>
        <div><span>BILLED</span><b>${money(billed)}</b></div>
      </div>`;

    $("parsed").hidden = false;
    $("runBtn").disabled = false;

    document.querySelectorAll(".fixture").forEach((f) =>
      f.classList.toggle("is-picked", f.dataset.name === source));
  }


  function readFile(file) {

    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showError("That file is larger than 2 MB. A claim is a small JSON document.");
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => showError("The file could not be read.");

    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (error) {
        showError(`That file is not valid JSON — ${error.message}`);
        return;
      }
      accept(parsed, file.name);
    };

    reader.readAsText(file);
  }


  const drop = $("drop");

  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    }));

  ["dragleave", "drop"].forEach((type) =>
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
    }));

  drop.addEventListener("drop", (e) => readFile(e.dataTransfer?.files?.[0]));

  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); }
  });

  $("fileInput").addEventListener("change", (e) => readFile(e.target.files[0]));

  // Paste a claim straight in, which is faster than saving a file
  // just to drop it.
  addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text");
    if (!text || !text.trim().startsWith("{")) return;
    try {
      accept(JSON.parse(text), "pasted");
    } catch (error) {
      showError(`That paste is not valid JSON — ${error.message}`);
    }
  });


  $("shapeSample").textContent = JSON.stringify(SAMPLE, null, 2);

  $("downloadSample").onclick = () => {
    const blob = new Blob([JSON.stringify(SAMPLE, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-claim.json";
    a.click();
    URL.revokeObjectURL(url);
  };


  function renderFixtures() {

    $("fixtureList").innerHTML = scenarios.map((s, i) => {
      const name = String(s.name).replace(/^\d+\s*·\s*/, "");
      return `
        <button class="fixture" data-i="${i}" data-name="${esc(s.name)}" type="button">
          <span class="fixture-n">${String(i + 1).padStart(2, "0")}</span>
          <span class="fixture-name">${esc(name)}</span>
          <span class="fixture-npi">${esc(s.claim.npi || "no npi")}</span>
        </button>`;
    }).join("");

    $("fixtureList").querySelectorAll(".fixture").forEach((button) => {
      button.onclick = () => {
        const s = scenarios[Number(button.dataset.i)];
        accept({
          ...s.claim,
          claimNumber: s.claim.claimNumber ||
            `CLM-${Math.floor(10000 + Math.random() * 89999)}`
        }, s.name);
      };
    });
  }


  // =============================================
  // THE RUN
  // =============================================

  const STAGES = [
    { id: "intake",   name: "Claim intake",
      waiting: "Reading the submitted claim…" },
    { id: "rules",    name: "Claim axis · rules",
      waiting: "Checking the line items against the deterministic rules…" },
    { id: "registry", name: "Provider axis · federal registry",
      waiting: "An agent panel is querying the registry. This is the slow part, and we cannot see inside it." },
    { id: "coverage", name: "Coverage",
      waiting: "Working out what was and was not checked…" },
    { id: "routing",  name: "Routing",
      waiting: "Composing the two axes…" },
    { id: "outreach", name: "Outreach",
      waiting: "Deciding whether anyone should be approached…" }
  ];


  function readStages(d) {

    const v = d.verification || {}, r = d.routing, o = d.outreach;
    const cov = v.coverage || {}, checks = v.checks || [], obs = d.observations || [];
    const lines = d.lineItems || [];
    const pct = cov.completeness != null ? Math.round(cov.completeness * 100) : null;

    return {

      intake: {
        tone: "unknown",
        mark: `${lines.length} line${lines.length === 1 ? "" : "s"}`,
        detail: `${esc(d.claimNumber)} · ${money(d.totalBilled)} billed · ` +
                (d.npi ? `NPI ${esc(d.npi)}` : "no NPI supplied")
      },

      rules: {
        tone: LEVEL[d.reviewLevel] || "unknown",
        mark: `${d.reviewPriority}/100`,
        detail: `${obs.length} observation${obs.length === 1 ? "" : "s"} · ` +
                `${money(d.reviewAmount)} flagged for a person to look at.`
      },

      registry: {
        tone: bandTone(v.confidenceBand, v.blocking),
        mark: v.confidenceBand || "not run",
        detail:
          (v.blocking
            ? `Blocking discrepancy — ${esc(stripStop(v.blockingReason) || "the assessment stopped here")}. `
            : "") +
          (v.dataConfidenceScore == null
            ? "No score: verification did not complete. That is our gap, not a finding about the provider."
            : `Data confidence ${v.dataConfidenceScore}/100 across ` +
              `${checks.length} check${checks.length === 1 ? "" : "s"}`) +
          (v.durationMs ? ` · the registry query took ${secs(v.durationMs)}` : "")
      },

      coverage: {
        tone: pct === 100 ? "clear" : "unknown",
        mark: pct == null ? "unreported" : `${pct}%`,
        detail: pct == null
          ? "Coverage was not reported for this run."
          : `Checked ${esc((cov.checked || []).join(", ") || "nothing")}.` +
            ((cov.skipped || []).length
              ? ` Not checked: ${esc((cov.skipped || [])
                  .map((s) => s.label || s.id).join(", "))} — a statement about our coverage, ` +
                `not about the provider.`
              : "")
      },

      routing: r
        ? { tone: DEC[r.decision] || "unknown",
            mark: String(r.decision || "routed").replace(/_/g, " "),
            detail: esc(r.headline || "") + (r.queue ? ` → ${esc(r.queue)}` : "") }
        : { tone: "unknown", mark: "not routed",
            detail: "No routing decision was returned." },

      outreach: o
        ? (o.queued
            ? { tone: "watch", mark: `tier ${o.tier} queued`,
                detail: `${esc(o.channel || "An approach")} drafted and waiting for a named ` +
                        `person to approve it. Nothing has been sent.` }
            : { tone: "clear", mark: "none needed",
                detail: esc(o.reason || "No approach was queued.") })
        : { tone: "unknown", mark: "not evaluated",
            detail: "Outreach was not evaluated for this claim." }
    };
  }


  function show(id) {
    const act = $(id);
    if (!act.hidden) return act;
    act.hidden = false;
    recollect();
    return act;
  }


  async function run() {

    if (!state.claim || state.running) return;

    state.running = true;
    state.result = null;

    $("runBtn").classList.add("is-running");
    $("runMicro").textContent = "RUNNING";
    $("runTitle").innerHTML = "BOTH AXES,<br />IN FLIGHT.";
    $("runSub").textContent =
      "The claim rules finish immediately. The provider panel is talking to the federal " +
      "registry, so it takes as long as it takes — there is no progress to report until it " +
      "answers.";

    $("film").dataset.state = "running";
    $("film").innerHTML =
      `<div class="beam"></div>` +
      STAGES.map((s) => `
        <li class="row is-waiting" data-stage="${s.id}">
          <span class="node"><i></i></span>
          <p class="row-name">${esc(s.name)}</p>
          <span class="row-mark"></span>
          <p class="row-detail">${esc(s.waiting)}</p>
        </li>`).join("");

    const act = show("run");
    scrollToEl(act);

    const startedAt = performance.now();

    try {

      const response = await fetch("/api/claims/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.claim)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error((data.errors || [data.error]).filter(Boolean).join(" ") ||
                        `The server answered ${response.status}.`);
      }

      state.result = data;
      state.running = false;

      const roundTripMs = performance.now() - startedAt;
      const registryMs = data.verification?.durationMs || 0;

      // A provider result served from cache comes back far faster
      // than the query it is reporting. Say so, rather than let the
      // timer imply the registry was asked again.
      const cached = registryMs > 0 && roundTripMs < registryMs / 2;

      const elapsed = roundTripMs < 100 ? "<0.1s" : secs(roundTripMs);

      $("film").dataset.state = "resolved";
      $("runMicro").textContent =
        `ANSWERED IN ${elapsed}` +
        (cached ? " · REGISTRY RESULT SERVED FROM CACHE" : "");
      $("runTitle").innerHTML = "BOTH AXES,<br />ANSWERED.";
      $("runSub").textContent =
        "Every row below is what the response actually contained. Nothing here is inferred " +
        "from how long the wait was.";

      const resolved = readStages(data);

      for (const stage of STAGES) {
        const row = $("film").querySelector(`[data-stage="${stage.id}"]`);
        const info = resolved[stage.id];
        row.querySelector(".row-detail").innerHTML = info.detail;
        row.querySelector(".row-mark").textContent = info.mark;
        row.classList.remove("is-waiting");
        row.classList.add("is-done", `t-${info.tone}`);
        if (!reduced) await sleep(200);
      }

      renderVerdict(data);
      renderDossier(data);
      show("verdict");
      show("evidence");
      await loadLedger();
      await loadField();
      recollect();

    } catch (error) {

      state.running = false;
      $("film").dataset.state = "failed";
      $("runMicro").textContent = "FAILED";
      $("runTitle").innerHTML = "THE RUN DID<br />NOT COMPLETE.";
      $("runSub").textContent =
        `Nothing was assessed. This is a failure on our side and says nothing about the ` +
        `provider or the claim. ${error.message}`;

    } finally {
      $("runBtn").classList.remove("is-running");
    }
  }


  // =============================================
  // VERDICT
  // =============================================

  const CIRC = 2 * Math.PI * 52;

  function gauge(value, tone, caption) {

    const known = value != null && !Number.isNaN(Number(value));

    return `
      <div class="gauge t-${esc(tone)}" data-v="${known ? Number(value) : ""}"
           role="img" aria-label="${known ? Number(value) + " out of 100" : "not scored"}">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="gauge-track" cx="60" cy="60" r="52"></circle>
          <circle class="gauge-arc"   cx="60" cy="60" r="52"></circle>
        </svg>
        <div class="gauge-num">
          <strong>${known ? Number(value) : "—"}</strong>
          <span>${known ? esc(caption) : "NOT SCORED"}</span>
        </div>
      </div>`;
  }

  function drawGauges() {
    document.querySelectorAll(".gauge").forEach((g) => {
      if (g.dataset.v === "") return;
      const v = Math.max(0, Math.min(100, Number(g.dataset.v)));
      const arc = g.querySelector(".gauge-arc");
      arc.style.strokeDashoffset = String(CIRC);
      const draw = () => { arc.style.strokeDashoffset = String(CIRC * (1 - v / 100)); };
      if (reduced || document.hidden) draw();
      else requestAnimationFrame(() => requestAnimationFrame(draw));
    });
  }


  function renderVerdict(d) {

    const v = d.verification || {}, r = d.routing;
    const cTone = LEVEL[d.reviewLevel] || "unknown";
    const pTone = bandTone(v.confidenceBand, v.blocking);
    const dTone = r ? (DEC[r.decision] || "unknown") : "unknown";

    document.body.dataset.tone = dTone;

    $("verdictMicro").textContent = `VERDICT · ${String(d.claimNumber || "").toUpperCase()}`;
    $("verdictHead").textContent = r ? (r.headline || "ROUTED") : "ROUTED";
    $("verdictProvider").textContent =
      `${d.providerName}${d.npi ? ` · NPI ${d.npi}` : " · no NPI supplied"}`;

    $("routingSlot").innerHTML = r ? `
      <div class="routing t-${esc(dTone)}">
        <h3>${esc(String(r.decision || "").replace(/_/g, " "))}</h3>
        <p>${esc(r.reason || "")}</p>
        <div class="chips">
          ${r.queue ? `<span class="chip">→ ${esc(r.queue)}</span>` : ""}
          <span class="chip">${esc(d.claimNumber)}</span>
        </div>
        ${r.note ? `<p class="routing-note">${esc(r.note)}</p>` : ""}
      </div>` : "";

    // The two axes run in opposite directions — 0 is good on one
    // and bad on the other — so each gauge states which way.
    $("gauges").innerHTML = `
      <div class="gauge-cell">
        ${gauge(d.reviewPriority, cTone, "0 = NOTHING TO SEE")}
        <div>
          <p class="micro" style="margin-bottom:6px">AXIS ONE · THE CLAIM</p>
          <h4>Review priority</h4>
          <p>How much of the claim's own content needs a person to look at it. Deterministic,
             and it never depends on who the provider is.</p>
          <span class="band t-${esc(cTone)}">${esc(d.reviewLevel)}</span>
        </div>
      </div>
      <div class="gauge-cell">
        ${gauge(v.dataConfidenceScore ?? null, pTone, "100 = CORROBORATED")}
        <div>
          <p class="micro" style="margin-bottom:6px">AXIS TWO · THE RECORD</p>
          <h4>Data confidence</h4>
          <p>How well the provider record matches the federal registry. A low score is a
             statement about the evidence, never about the provider.</p>
          <span class="band t-${esc(pTone)}">${esc(v.confidenceBand || "not run")}</span>
        </div>
      </div>`;

    $("meta").innerHTML = `
      <div><span>TOTAL BILLED</span><strong>${money(d.totalBilled)}</strong></div>
      <div><span>TO REVIEW</span><strong>${money(d.reviewAmount)}</strong></div>
      <div><span>OBSERVATIONS</span><strong>${(d.observations || []).length}</strong></div>
      <div><span>REGISTRY CHECKS</span><strong>${(v.checks || []).length}</strong></div>`;

    drawGauges();
  }


  // =============================================
  // EVIDENCE
  // =============================================

  function renderDossier(d) {

    const v = d.verification || {}, cov = v.coverage || {};
    const checks = v.checks || [], obs = d.observations || [], o = d.outreach;
    const pct = cov.completeness != null ? Math.round(cov.completeness * 100) : null;

    $("dossier").innerHTML = `

      ${v.blocking ? `
        <div class="blocking">
          <strong>Blocking discrepancy — the assessment stopped here.</strong>
          <p>${esc(v.blockingReason || "")}</p>
          <p>A blocking finding is not one signal among several. The remaining checks cannot
             offset it, and no outreach is attempted: there is no verified party to contact.</p>
        </div>` : ""}

      <h3>THE PROVIDER RECORD</h3>

      ${v.rationale ? `<p class="note">${esc(v.rationale)}</p>` : ""}

      ${checks.length ? checks.map((c) => `
        <div class="card t-${esc(CHECK[c.result] || "unknown")}">
          <div class="card-head">
            <strong>${esc(c.dimension)}</strong>
            <span class="tag">${esc(String(c.result).replace(/_/g, " "))}</span>
          </div>
          ${c.summary ? `<p>${esc(c.summary)}</p>` : ""}
          ${c.limitations ? `<p class="limits">${esc(c.limitations)}</p>` : ""}
        </div>`).join("") : `<p class="note">No checks ran for this claim.</p>`}

      ${pct != null ? `
        <p class="note">
          Coverage ${pct}% — checked ${esc((cov.checked || []).join(", ") || "nothing")}.
          ${(cov.skipped || []).length
            ? `Not checked: ${esc((cov.skipped || [])
                .map((s) => s.label || s.id).join(", "))}. That is a statement about our
               coverage, not about the provider.` : ""}
        </p>` : ""}

      <h3>OBSERVATIONS ON THE CLAIM</h3>

      ${obs.length ? obs.map((x) => `
        <div class="card t-${esc(WEIGHT[x.weight] || "unknown")}">
          <div class="card-head">
            <strong>${esc(x.observation || "")}</strong>
            <span class="tag">${esc(x.weight || "")}</span>
          </div>
          ${x.evidence ? `<p>${esc(x.evidence)}</p>` : ""}
          ${x.innocentExplanation
            ? `<p class="innocent"><b>Ordinary explanation</b>${esc(x.innocentExplanation)}</p>`
            : ""}
        </div>`).join("") : `
        <div class="card t-clear">
          <div class="card-head"><strong>Nothing on the claim needs a second look.</strong></div>
          <p>This is not a guarantee of correctness — it means the deterministic rules did not
             raise anything.</p>
        </div>`}

      <h3>OUTREACH</h3>

      ${o ? (o.queued ? `
        <div class="card t-watch">
          <div class="card-head">
            <strong>Tier ${esc(o.tier)} — ${esc(o.channel || "")}</strong>
            <span class="tag">${esc(o.status || "")}</span>
          </div>
          <p>${esc(o.note || "")}</p>
          <p class="limits">Queue #${esc(o.outreachId)}. Nothing is sent until a named person
             approves it.</p>
        </div>` : `
        <div class="card t-clear">
          <div class="card-head"><strong>No approach queued.</strong></div>
          <p>${esc(o.reason || "")}</p>
          ${o.route ? `<p class="limits">Routed to ${esc(o.route)}.</p>` : ""}
        </div>`) : `<p class="note">Outreach was not evaluated for this claim.</p>`}
    `;
  }


  // =============================================
  // LEDGER
  // =============================================

  async function loadLedger() {

    try {

      const response = await fetch("/api/dashboard");
      const data = await response.json();

      $("tiles").innerHTML = `
        <div class="tile"><span>CLAIMS ASSESSED</span><strong>${data.stats.claimsAnalyzed}</strong></div>
        <div class="tile"><span>NEED A LOOK</span><strong>${data.stats.needsReview}</strong></div>
        <div class="tile"><span>AMOUNT TO REVIEW</span><strong>${money(data.stats.reviewAmount)}</strong></div>
        <div class="tile"><span>REPEATED LINE ITEMS</span><strong>${data.stats.repeatedLineObservations}</strong></div>`;

      $("ledgerBody").innerHTML = data.claims.length
        ? data.claims.map(row).join("")
        : `<tr><td colspan="7" class="empty">Nothing assessed yet.</td></tr>`;

      $("ledgerBody").querySelectorAll("tr[data-id]").forEach((tr) => {
        tr.onclick = () => openClaim(tr.dataset.id);
      });

    } catch (error) {
      $("ledgerBody").innerHTML =
        `<tr><td colspan="7" class="empty">The ledger could not be loaded: ${
          esc(error.message)}</td></tr>`;
    }
  }


  /* Opens one stored claim into the verdict and evidence scenes.
     Shared by the ledger rows and the nodes in the field. */
  async function openClaim(id) {
    try {
      const response = await fetch(`/api/claims/${id}`);
      const claim = await response.json();
      state.result = claim;
      renderVerdict(claim);
      renderDossier(claim);
      show("verdict");
      show("evidence");
      scrollToEl($("verdict"));
    } catch (error) {
      console.error("Could not open that claim:", error);
    }
  }


  function row(c) {

    const v = c.verification || {}, band = v.confidenceBand;
    const cTone = LEVEL[c.reviewLevel] || "unknown";

    return `
      <tr data-id="${esc(c.id)}">
        <td class="claim-no">${esc(c.claimNumber)}</td>
        <td>${esc(c.providerName)}</td>
        <td class="num">${money(c.totalBilled)}</td>
        <td><span class="mini t-${esc(cTone)}">${esc(c.reviewLevel)}</span>
            <span class="dash"> ${c.reviewPriority}</span></td>
        <td>${band
          ? `<span class="mini t-${esc(bandTone(band, v.blocking))}">${esc(band)}</span>`
          : `<span class="dash">—</span>`}</td>
        <td>${c.routing ? esc(c.routing.queue || "auto-process") : `<span class="dash">—</span>`}</td>
        <td class="num">${money(c.reviewAmount)}</td>
      </tr>`;
  }


  // =============================================
  // BOOT
  // =============================================

  root.classList.add("is-locked");

  renderFixtures();
  loadField();
  loadLedger();

  $("runBtn").onclick = run;

  addEventListener("resize", () => {
    clearTimeout(window._fieldTimer);
    window._fieldTimer = setTimeout(() => { Field.size(); measure(); }, 220);
  });

  boot();

})();
