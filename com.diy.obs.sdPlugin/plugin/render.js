// OBS Deck - draws keys as 144x144 SVG.
// Light keys with the Audio Profiles type tokens (Inter Bold, label 14, value 26-30).
// On-air states get a hazard-tape frame (red / yellow), the next scene a green line,
// OBS offline a grey dashed line. Runs in Node (the plugin) and in the browser (settings previews).
(function (root) {
    'use strict';

    const FONT = "Inter, 'Segoe UI Variable Display', 'Segoe UI', 'SF Pro Display', Arial, sans-serif";
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const RED = '#ff3b30', GREEN = '#22b04b', AMBER = '#f2a900', BLUE = '#3b8bff';
    const AMBER_TEXT = '#a86a00'; // amber text needs a darker shade to read on the light key
    const ink = c => c === AMBER ? AMBER_TEXT : c;
    const P = {
        bg1: '#f7f6f2', bg2: '#e2e0d8', edge: '#cbc8bf', text: '#1d1c1a', cap: '#7b786f', dim: '#b5b2a9',
        seg: 'rgba(29,28,26,.10)', icon: '#1d1c1a', hi: 'rgba(242,169,0,.20)', red: '#e8261b', tape: '#1d1c1a',
    };
    let uid = 0;

    // ---------- icons (64 box, filled; fill="BG" = key background cut-out) ----------
    const ICON = {
        mic: '<path d="M32 5c4.4 0 8 3.6 8 8v15c0 4.4-3.6 8-8 8s-8-3.6-8-8V13c0-4.4 3.6-8 8-8Z"/><path d="M11.4 29a2.6 2.6 0 0 1 5.2 0 15.4 15.4 0 0 0 30.8 0 2.6 2.6 0 0 1 5.2 0c0 10.5-7.9 19.2-18 20.4v6H41a2.6 2.6 0 0 1 0 5.2H23a2.6 2.6 0 0 1 0-5.2h6.4v-6C19.3 48.2 11.4 39.5 11.4 29Z"/>',
        game: '<path d="M18 16h28c8 0 13 6 15 14l2 12c1 6-3 10-8 10-3 0-5-1-7-4l-4-5H20l-4 5c-2 3-4 4-7 4-5 0-9-4-8-10l2-12c2-8 7-14 15-14Z"/><g fill="BG"><rect x="14" y="27" width="14" height="5" rx="2"/><rect x="18.5" y="22.5" width="5" height="14" rx="2"/><circle cx="44" cy="25" r="3.5"/><circle cx="50" cy="32" r="3.5"/></g>',
        music: '<path d="M24 12 54 6v34a8 8 0 1 1-5.2-7.5V19.3L29.2 23v25a8 8 0 1 1-5.2-7.5V12Z"/>',
        bell: '<path d="M32 6c1.7 0 3 1.3 3 3v2c8 1.5 13 8.4 13 16.5V40l5 6v3H11v-3l5-6V27.5C16 19.4 21 12.5 29 11V9c0-1.7 1.3-3 3-3Z"/><path d="M25 52h14a7 7 0 0 1-14 0Z"/>',
        desktop: '<path d="M8 10h48a3 3 0 0 1 3 3v29a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z"/><path d="M29.4 45h5.2v8.4H44a2.6 2.6 0 0 1 0 5.2H20a2.6 2.6 0 0 1 0-5.2h9.4V45Z"/>',
        chat: '<path d="M10 10h44a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H28L15 56V45h-5a5 5 0 0 1-5-5V15a5 5 0 0 1 5-5Z"/>',
        speaker: '<path d="M8 24h10l14-12v40L18 40H8Z"/><path d="M40.2 23.9a2.6 2.6 0 0 1 3.7-3.7 16.6 16.6 0 0 1 0 23.6 2.6 2.6 0 1 1-3.7-3.7 11.4 11.4 0 0 0 0-16.2Zm7-7a2.6 2.6 0 0 1 3.7-3.7 26.6 26.6 0 0 1 0 37.6 2.6 2.6 0 1 1-3.7-3.7 21.4 21.4 0 0 0 0-30.2Z"/>',
        antenna: '<circle cx="32" cy="30" r="7"/><path d="M29 36h6l5 22h-16Z"/><path d="M17.9 15.9a20 20 0 0 0 0 28.2l-3.7 3.7a25.2 25.2 0 0 1 0-35.6Zm28.2 0 3.7-3.7a25.2 25.2 0 0 1 0 35.6l-3.7-3.7a20 20 0 0 0 0-28.2Z"/><path d="M25 22.9a10 10 0 0 0 0 14.2l-3.6 3.6a15.2 15.2 0 0 1 0-21.4Zm14 0 3.6-3.6a15.2 15.2 0 0 1 0 21.4L39 37.1a10 10 0 0 0 0-14.2Z"/>',
        rec: '<circle cx="32" cy="32" r="18"/>',
        webcam: '<path d="M50 25a18 18 0 1 1-36 0 18 18 0 0 1 36 0Z"/><circle cx="32" cy="25" r="7" fill="BG"/><path d="M19 58h26l-4-12H23Z"/>',
        replay: '<path d="M32 8a24 24 0 1 1-22.6 32l4.9-1.7A18.8 18.8 0 1 0 17 20.2l5.7 5.7H6.6V9.8l6.6 6.6A24 24 0 0 1 32 8Z"/><path d="M28 22l14 10-14 10Z"/>',
        camera: '<path d="M22 12h20l4 7h9a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V23a4 4 0 0 1 4-4h9Z"/><circle cx="32" cy="36" r="10" fill="BG"/><circle cx="32" cy="36" r="5.5"/>',
        studio: '<rect x="4" y="16" width="26" height="20" rx="3"/><rect x="34" y="16" width="26" height="20" rx="3"/><path d="M14 41.4h31.6l-4-3.4 3.4-3.9 9.6 8.3-9.6 8.3-3.4-3.9 4-3.4H14Z"/>',
        scene: '<rect x="6" y="12" width="52" height="34" rx="4"/><path d="M22 50h20v5H22Z"/>',
        pause: '<rect x="18" y="14" width="10" height="36" rx="3"/><rect x="36" y="14" width="10" height="36" rx="3"/>',
        eye: '<path d="M32 14c13 0 23 9 28 18-5 9-15 18-28 18S9 41 4 32c5-9 15-18 28-18Z"/><circle cx="32" cy="32" r="10" fill="BG"/><circle cx="32" cy="32" r="5"/>',
        mixer: '<rect x="11" y="6" width="6" height="52" rx="3"/><rect x="29" y="6" width="6" height="52" rx="3"/><rect x="47" y="6" width="6" height="52" rx="3"/><rect x="6" y="34" width="16" height="10" rx="3"/><rect x="24" y="14" width="16" height="10" rx="3"/><rect x="42" y="40" width="16" height="10" rx="3"/>',
    };
    const ICON_NAMES = { auto: 'Automatic', mic: 'Microphone', game: 'Game', music: 'Music', bell: 'Alerts', desktop: 'Desktop', chat: 'Voice chat', speaker: 'Speaker' };

    function icon(name, x, y, size, color, op) {
        const s = size / 64, body = (ICON[name] || ICON.speaker).replace(/fill="BG"/g, `fill="${P.bg2}"`);
        return `<g transform="translate(${x} ${y}) scale(${s.toFixed(4)})" fill="${color}"${op != null ? ` opacity="${op}"` : ''}>${body}</g>`;
    }
    function strike(x, y, size) {
        const d = `M${x + 3} ${y + 3}L${x + size - 3} ${y + size - 3}`;
        return `<path d="${d}" stroke="${P.bg2}" stroke-width="${(size / 6).toFixed(1)}" stroke-linecap="round"/><path d="${d}" stroke="${P.red}" stroke-width="${(size / 12).toFixed(1)}" stroke-linecap="round"/>`;
    }
    const t = (x, y, s, size, fill, o = {}) => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${o.w || 700}" fill="${fill}" text-anchor="${o.a || 'middle'}" letter-spacing="${o.ls || 0}">${esc(s)}</text>`;
    const cut = (s, n) => { const v = String(s || '').toUpperCase(); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
    const label = (y, s, fill, size) => t(72, y, cut(s, size > 15 ? 9 : 12), size || 15, fill);
    const rr = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

    // ---------- frame ----------
    // o.ring: { color, hazard, dashed, glow }; o.tint: fill over the whole key
    // Stream Dock draws SVG with a small renderer (SVG Tiny level): no rgba(), <pattern>, <filter> or clip paths.
    // So stripes are real polygons cut to the key outline, and see-through colours use fill-opacity.
    function roundRectPoly(x, y, w, h, r) {
        const pts = [], seg = 6;
        [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]].forEach(([cx, cy, a0]) => {
            for (let k = 0; k <= seg; k++) { const a = (a0 + 90 * k / seg) * Math.PI / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        });
        return pts;
    }
    // Sutherland-Hodgman: clip a polygon to a convex polygon (clockwise in screen coordinates)
    function clipPoly(poly, clip) {
        let out = poly;
        for (let i = 0; i < clip.length && out.length; i++) {
            const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
            const inside = ([px, py]) => (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0;
            const cross = (p, q) => {
                const [px, py] = p, [qx, qy] = q, dx = qx - px, dy = qy - py, ex = bx - ax, ey = by - ay;
                const tt = ((ax - px) * ey - (ay - py) * ex) / (dx * ey - dy * ex);
                return [px + tt * dx, py + tt * dy];
            };
            const inp = out; out = [];
            for (let k = 0; k < inp.length; k++) {
                const cur = inp[k], prev = inp[(k + inp.length - 1) % inp.length];
                if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
                else if (inside(prev)) out.push(cross(prev, cur));
            }
        }
        return out;
    }
    const OUTER = roundRectPoly(2, 2, 140, 140, 20);
    let tapeCache = '';
    function tapeStripes() {
        if (tapeCache) return tapeCache;
        let d = '';
        for (let k = -20; k < 300; k += 17) {
            const poly = clipPoly([[k + 10, -10], [k + 18.5, -10], [k + 8.5 - 154, 154], [k - 154, 154]], OUTER);
            if (poly.length > 2) d += 'M' + poly.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L') + 'Z';
        }
        return (tapeCache = d);
    }
    function frame(inner, o = {}) {
        const id = 'k' + (uid++);
        let ring = '';
        if (o.ring && o.ring.hazard) {
            const c = o.ring.color;
            ring = `<path fill="${c}" d="${rr(2, 2, 140, 140, 20)}"/><path fill="${P.tape}" d="${tapeStripes()}"/>` +
                `<path fill="url(#${id}g)" stroke="${P.tape}" stroke-width="1.5" d="${rr(10, 10, 124, 124, 12)}"/>`;
        } else if (o.ring) {
            const c = o.ring.color;
            ring = `<rect x="4.5" y="4.5" width="135" height="135" rx="18" fill="none" stroke="${c}" stroke-width="${o.ring.dashed ? 4 : 6}"${o.ring.dashed ? ' stroke-dasharray="10 8"' : ''}/>`;
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><defs>` +
            `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.bg1}"/><stop offset="1" stop-color="${P.bg2}"/></linearGradient></defs>` +
            `<rect width="144" height="144" rx="22" fill="url(#${id}g)"/><rect x="1" y="1" width="142" height="142" rx="21" fill="none" stroke="${P.edge}" stroke-width="2"/>` +
            ring + (o.tint ? `<rect x="2" y="2" width="140" height="140" rx="20" fill="${o.tint}"/>` : '') + inner + `</svg>`;
        return tiny(svg);
    }
    // rgba(r,g,b,a) -> #rrggbb plus fill-opacity / stroke-opacity
    function tiny(svg) {
        return svg.replace(/(fill|stroke)="rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)"/g, (m, attr, r, g, b, a) =>
            `${attr}="#${[r, g, b].map(v => (+v).toString(16).padStart(2, '0')).join('')}" ${attr}-opacity="${a}"`);
    }
    const OFF_RING = { color: P.dim, dashed: true };
    function ledStrip(color, on) {
        return on ? `<rect x="40" y="120" width="64" height="8" rx="4" fill="${color}"/><rect x="46" y="122" width="52" height="2.5" rx="1.25" fill="#fff" fill-opacity=".45"/>`
            : `<rect x="40" y="120" width="64" height="8" rx="4" fill="${color}" fill-opacity=".22"/>`;
    }

    // ---------- meter ----------
    // 16 segments across -60...0 dB, fader triangle underneath, peak-hold segment.
    const SEG = 16, toSeg = db => db <= -60 ? 0 : Math.max(0, Math.min(SEG, Math.round((db + 60) / 60 * SEG)));
    function meter(x, y, w, h, lvl, peak, fader, muted) {
        const gap = 2, sw = (w - gap * (SEG - 1)) / SEG, lit = muted ? 0 : toSeg(lvl), pk = muted ? -1 : toSeg(peak) - 1;
        let s = '';
        for (let i = 0; i < SEG; i++) {
            const db = -60 + (i + 1) * 60 / SEG, c = db > -6 ? RED : db > -18 ? AMBER : GREEN;
            s += `<rect x="${(x + i * (sw + gap)).toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="${h}" rx="1.5" fill="${i < lit || i === pk ? c : P.seg}"/>`;
        }
        if (fader != null) {
            const fx = x + Math.max(0, Math.min(1, (fader + 60) / 60)) * w;
            s += `<path d="M${fx.toFixed(1)} ${y + h + 1}l6 8h-12Z" fill="${P.red}"/>`;
        }
        return s;
    }
    const fmtDb = v => v == null ? '--' : v <= -60 ? '−∞ dB' : (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + ' dB';
    function hms(sec) { sec = Math.max(0, Math.floor(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0'); }

    // ---------- layouts ----------
    // track: { name, icon, vol (dB), muted, lvl, peak (dB, after the fader) }

    // Two tracks on one key. o = { hot: 0 | 1 | null, offline }
    function duo(a, b, o = {}) {
        let s = '';
        [[a, 14], [b, 80]].forEach(([tr, y], i) => {
            if (!tr) { s += t(72, y + 26, 'SET UP', 13, P.cap); return; }
            if (o.hot === i) s += `<rect x="6" y="${y - 8}" width="132" height="58" rx="12" fill="${P.hi}"/>`;
            const lc = tr.muted ? P.red : P.text;
            s += icon(tr.icon, 14, y - 4, 22, tr.muted ? P.red : P.icon, o.offline ? .38 : null);
            s += t(41, y + 14, cut(tr.name, tr.muted ? 7 : 6), 13, o.offline ? P.cap : lc, { a: 'start' });
            s += tr.muted ? `<rect x="108" y="${y - 1}" width="20" height="19" rx="5" fill="${P.red}"/>` + t(118, y + 13.5, 'M', 14, '#ffffff')
                : t(128, y + 14, fmtDb(tr.vol).replace(' dB', ''), 13, o.offline ? P.cap : P.text, { a: 'end' });
            s += meter(16, y + 24, 112, 10, o.offline ? -100 : tr.lvl, o.offline ? -100 : tr.peak, tr.vol, tr.muted);
        });
        s += `<rect x="16" y="70" width="112" height="1.5" fill="${P.edge}"/>`;
        return frame(s, { ring: o.offline ? OFF_RING : null });
    }

    // One track with a bar meter. o = { dots: { i, n }, hot, offline }
    function track(tr, o = {}) {
        if (!tr) return idle({ icon: 'speaker', name: o.title || 'TRACK', caption: o.offline ? 'OBS OFFLINE' : 'SET UP', offline: o.offline });
        let s = '';
        if (o.hot) s += `<rect x="6" y="6" width="132" height="132" rx="18" fill="${P.hi}"/>`;
        s += icon(tr.icon, 54, 8, 36, tr.muted ? P.red : P.icon, o.offline ? .38 : null);
        if (tr.muted) s += strike(54, 8, 36);
        s += label(62, tr.name, tr.muted ? P.red : P.cap);
        s += t(72, 90, tr.muted ? 'MUTED' : fmtDb(tr.vol), 26, tr.muted ? P.red : o.offline ? P.cap : P.text);
        s += meter(16, 100, 112, 10, o.offline ? -100 : tr.lvl, o.offline ? -100 : tr.peak, tr.vol, tr.muted);
        s += dots(o.dots);
        return frame(s, { ring: o.offline ? OFF_RING : null });
    }
    function dots(d) {
        if (!d || d.n < 2) return '';
        const n = Math.min(d.n, 9), i0 = Math.min(d.i, n - 1), w = 8 + 6 * (n - 1) + 5 * (n - 1);
        let x = 72 - w / 2, s = '';
        for (let i = 0; i < n; i++) { const r = i === i0 ? 8 : 6; s += `<circle cx="${(x + r / 2).toFixed(1)}" cy="128" r="${r / 2}" fill="${i === i0 ? P.text : P.dim}"/>`; x += r + 5; }
        return s;
    }

    // Analog VU meter: backlit amber glass, needle from a pivot below it. Scale -40...0 dB, red zone above 0.
    const VU_A = 28 * Math.PI / 180, VU_PX = 72, VU_PY = 150;
    const vuPos = db => Math.pow(Math.max(0, Math.min(45, db + 40)) / 45, 1.15);
    const vuXY = (db, r) => { const a = -VU_A + 2 * VU_A * vuPos(db); return [VU_PX + r * Math.sin(a), VU_PY - r * Math.cos(a)]; };
    function vu(tr, o = {}) {
        if (!tr) return track(null, o);
        const id = 'v' + (uid++), lit = !tr.muted && !o.offline;
        const ink = lit ? '#3a1d08' : '#3b342c', red = lit ? '#c8200e' : '#5a3a33';
        let s = `<defs><radialGradient id="${id}g" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="${lit ? '#ffd27a' : '#8a7a66'}"/><stop offset=".6" stop-color="${lit ? '#ffa733' : '#6e604f'}"/><stop offset="1" stop-color="${lit ? '#e2700f' : '#544838'}"/></radialGradient>` +
            `</defs>`;
        s += `<rect x="10" y="10" width="124" height="98" rx="10" fill="#1d1c1a"/><rect x="12" y="12" width="120" height="94" rx="8" fill="url(#${id}g)"/><g>`;
        const arc = (d0, d1, r) => { const [x0, y0] = vuXY(d0, r), [x1, y1] = vuXY(d1, r); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
        s += `<path d="${arc(-40, 0, 98)}" fill="none" stroke="${ink}" stroke-width="1.6"/><path d="${arc(0, 5, 98)}" fill="none" stroke="${red}" stroke-width="4"/>`;
        [-40, -30, -20, -15, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3, 5].forEach(d => {
            const major = [-40, -20, -10, 0, 5].includes(d), [x0, y0] = vuXY(d, 98), [x1, y1] = vuXY(d, major ? 105 : 102);
            s += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${d > 0 ? red : ink}" stroke-width="${major ? 2 : 1.3}"/>`;
        });
        [[-40, '40'], [-20, '20'], [-10, '10'], [0, '0']].forEach(([d, txt]) => { const [x, y] = vuXY(d, 114); s += t(Math.max(22, x).toFixed(1), (y + 4).toFixed(1), txt, 12, ink); });
        s += t(20, 82, 'VU', 12, ink, { a: 'start' });
        if (tr.vol != null) { const [fx, fy] = vuXY(tr.vol, 92); s += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="2.6" fill="${ink}"/>`; }
        const nd = lit ? (tr.vu != null ? tr.vu : tr.lvl) : -60, [nx, ny] = vuXY(Math.max(-42, nd), 110);
        const k0 = (VU_PY - 104) / (VU_PY - ny), sx = VU_PX + (nx - VU_PX) * k0; // needle starts at the bottom of the glass
        s += `<path d="M${sx.toFixed(1)} 104L${nx.toFixed(1)} ${ny.toFixed(1)}" stroke="#141210" stroke-width="2" stroke-linecap="round"/>`;
        s += `</g><rect x="12" y="12" width="120" height="16" rx="8" fill="#fff" fill-opacity=".10"/>`;
        s += t(16, 129, cut(tr.name, 9), 13, tr.muted ? P.red : P.text, { a: 'start' });
        s += t(128, 129, tr.muted ? 'MUTED' : fmtDb(tr.vol).replace(' dB', ''), 13, tr.muted ? P.red : P.text, { a: 'end' });
        return frame(s, { ring: o.offline ? OFF_RING : null, tint: o.hot ? P.hi : null });
    }

    // Icon + name + caption. o = { icon, name, caption, color, offline, iconColor }
    function idle(o) {
        let s = icon(o.icon, 48, 16, 48, o.iconColor || P.icon, o.offline ? .38 : null);
        s += label(86, o.name, o.offline ? P.cap : P.text) + t(72, 110, o.caption || '', 14, o.captionColor || P.cap, { ls: .3 });
        return frame(s, { ring: o.offline ? OFF_RING : null });
    }

    // Stream. o = { state: off | starting | live | stopping, t (s), kbps, drop (%), reconnecting, offline }
    function stream(o) {
        if (o.offline) return idle({ icon: 'antenna', name: 'STREAM', caption: 'OBS OFFLINE', offline: true });
        if (o.state === 'starting' || o.state === 'stopping' || o.reconnecting)
            return frame(icon('antenna', 52, 20, 40, P.icon) + label(86, 'STREAM', P.text) + t(72, 106, o.reconnecting ? 'RECONNECTING' : o.state === 'starting' ? 'STARTING…' : 'STOPPING…', 15, P.text), { ring: { color: AMBER, hazard: true } });
        if (o.state !== 'live') return idle({ icon: 'antenna', name: 'STREAM', caption: 'OFF AIR' });
        let s = `<rect x="30" y="22" width="84" height="26" rx="6" fill="${RED}"/><rect x="33" y="24" width="78" height="6" rx="3" fill="#fff" fill-opacity=".25"/>` + t(72, 40.5, 'ON AIR', 15, '#ffffff', { ls: 1.5 });
        s += t(72, 82, hms(o.t), 26, P.text);
        s += t(72, 102, o.kbps != null ? (o.kbps / 1000).toFixed(1) + ' Mbps' : '', 16, P.cap);
        s += t(72, 121, o.drop != null ? 'DROP ' + o.drop.toFixed(1) + '%' : '', 14, o.drop > 1 ? P.red : P.cap);
        return frame(s, { ring: { color: RED, hazard: true, glow: true } });
    }
    // Record. o = { state: off | rec | paused | starting | stopping, t, bytes, blink, offline }
    function record(o) {
        if (o.offline) return idle({ icon: 'rec', name: 'RECORD', caption: 'OBS OFFLINE', offline: true });
        if (o.state === 'paused')
            return frame(icon('pause', 58, 22, 28, P.text) + t(72, 72, 'PAUSED', 16, P.text) + t(72, 102, hms(o.t), 26, P.text), { ring: { color: AMBER, hazard: true } });
        if (o.state === 'starting' || o.state === 'stopping')
            return frame(icon('rec', 52, 20, 40, P.red) + label(86, 'RECORD', P.text) + t(72, 106, o.state === 'starting' ? 'STARTING…' : 'SAVING…', 15, P.text), { ring: { color: AMBER, hazard: true } });
        if (o.state !== 'rec') return idle({ icon: 'rec', name: 'RECORD', caption: 'STANDBY', iconColor: P.red });
        let s = `<circle cx="50" cy="36" r="8" fill="${RED}" opacity="${o.blink === false ? .25 : 1}"/>` + t(64, 42, 'REC', 17, RED, { a: 'start', ls: 1 });
        s += t(72, 84, hms(o.t), 26, P.text);
        if (o.bytes != null) s += t(72, 110, size(o.bytes), 17, P.cap);
        return frame(s, { ring: { color: RED, hazard: true, glow: true } });
    }
    const size = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB';

    // Scene: big name, one tag. o = { name, role: program | preview | '', offline, missing }
    function scene(o) {
        const role = o.offline || o.missing ? '' : o.role, c = role === 'program' ? RED : role === 'preview' ? GREEN : null;
        if (!o.name) return idle({ icon: 'scene', name: 'SCENE', caption: o.offline ? 'OBS OFFLINE' : 'SET UP', offline: o.offline });
        const words = String(o.name).toUpperCase().split(/\s+/).filter(Boolean), lines = [];
        words.forEach(w => { const l = lines[lines.length - 1]; if (l && (l + ' ' + w).length <= 9) lines[lines.length - 1] = l + ' ' + w; else lines.push(w); });
        const L = lines.slice(0, 2).map(x => x.length > 9 ? x.slice(0, 8) + '…' : x);
        if (lines.length > 2) L[1] = L[1].slice(0, 8) + '…';
        const fs = L.some(x => x.length > 7) ? 19 : 22;
        let s = '';
        if (c) s += `<rect x="47" y="24" width="50" height="22" rx="6" fill="${c}"/>` + t(72, 40, role === 'program' ? 'LIVE' : 'NEXT', 14, '#fff', { ls: 1 });
        else s += icon('scene', 50, 12, 44, P.icon, o.offline || o.missing ? .38 : .7);
        const y0 = L.length > 1 ? (o.dots ? 76 : 80) : (o.dots ? 88 : 92);
        L.forEach((x, i) => { s += t(72, y0 + i * (fs + 4), x, fs, o.offline || o.missing ? P.cap : P.text); });
        if (o.missing) s += t(72, 124, 'NOT FOUND', 13, P.red, { ls: .3 });
        else s += dots(o.dots);
        return frame(s, { ring: o.offline ? OFF_RING : role === 'program' ? { color: RED, hazard: true, glow: true } : c ? { color: c } : null });
    }
    // Mic mute (cough button). o = { name, muted, offline }
    function mic(o) {
        if (o.offline || !o.name) return idle({ icon: 'mic', name: o.name || 'MIC', caption: o.offline ? 'OBS OFFLINE' : 'SET UP', offline: o.offline });
        if (!o.muted) return frame(icon('mic', 46, 10, 52, P.icon) + label(88, o.name, P.text, 20) + t(72, 114, 'LIVE', 18, GREEN, { ls: .5 }));
        let s = icon('mic', 48, 18, 48, P.red) + strike(48, 18, 48);
        s += `<rect x="22" y="76" width="100" height="34" rx="8" fill="${P.red}"/>` + t(72, 100, 'MIC OFF', 20, '#fff', { ls: .5 });
        return frame(s, { ring: { color: RED, hazard: true } });
    }
    // Icon key with the LED strip. o = { icon, name, caption, color, on, pulse (0-1 opacity of a breathing icon), crossed, offline }
    function led(o) {
        if (o.offline) return idle({ icon: o.icon, name: o.name, caption: 'OBS OFFLINE', offline: true });
        let ico;
        const [ix, iy, is] = o.icon === 'studio' ? [34, -2, 76] : [46, 8, 52]; // the studio icon is wide and flat, so draw it larger
        if (o.on && o.pulse != null) ico = icon(o.icon, ix, iy, is, o.color, (0.3 + 0.7 * o.pulse).toFixed(2));
        else ico = icon(o.icon, ix, iy, is, P.icon, o.on ? null : .55) + (o.crossed && !o.on ? strike(46, 8, 52) : '');
        return frame(ico + label(80, o.name, P.text) + t(72, 102, o.caption || '', 14, o.on ? ink(o.color) : P.cap, { ls: .3 }) + ledStrip(o.color, o.on));
    }
    // Short confirmation after an action (screenshot saved, replay saved).
    function flash(o) {
        return frame(icon(o.icon, 46, 8, 52, AMBER) + label(80, o.name, P.text) + t(72, 104, o.msg, 16, AMBER_TEXT), { tint: 'rgba(242,169,0,.16)' });
    }
    // Amber LCD stats. o = { fps, cpu, drop, offline }
    function stats(o) {
        if (o.offline) return idle({ icon: 'mixer', name: 'STATS', caption: 'OBS OFFLINE', offline: true });
        // the LCD fills the whole key
        let b = `<rect x="6" y="6" width="132" height="132" rx="17" fill="#1a1608"/><rect x="6" y="6" width="132" height="132" rx="17" fill="${AMBER}" fill-opacity=".08"/>`;
        const rows = [['FPS', o.fps != null ? o.fps.toFixed(0) : '--'], ['CPU', o.cpu != null ? o.cpu.toFixed(0) + '%' : '--'], ['DROP', o.drop != null ? o.drop.toFixed(1) + '%' : '--']];
        rows.forEach(([k, v], i) => { b += t(16, 46 + i * 37, k, 15, AMBER, { a: 'start' }) + t(128, 47 + i * 37, v, 22, i === 2 && o.drop > 1 ? '#ff6a4d' : '#ffc400', { a: 'end' }); });
        return frame(b);
    }

    const api = { ICON, icon, duo, track, vu, idle, stream, record, scene, mic, led, flash, stats, fmtDb, hms, ICON_NAMES, COLORS: { RED, GREEN, AMBER, BLUE } };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.OBSRender = api;
})(this);
