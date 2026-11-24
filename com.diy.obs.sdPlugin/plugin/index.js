// OBS Deck - Stream Dock plugin for OBS Studio over obs-websocket v5.
// Keys follow the real OBS state from its events, so they stay right when you click in OBS itself.
// Knobs control the volume of any OBS audio input; keys show live levels.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const R = require('./render');

// ---------- log ----------
const logDir = path.join(__dirname, 'log');
try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
const logFile = path.join(logDir, 'plugin.log');
try { if (fs.statSync(logFile).size > 512 * 1024) fs.unlinkSync(logFile); } catch (_) {}
function log(...a) {
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`); } catch (_) {}
}
process.on('uncaughtException', e => log('uncaught', String(e && e.stack || e)));
process.on('unhandledRejection', e => log('unhandled', String(e && e.stack || e)));

// ---------- arguments from Stream Dock ----------
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const port = arg('-port') || process.argv[3];
const pluginUUID = arg('-pluginUUID') || process.argv[5];
const registerEvent = arg('-registerEvent') || process.argv[7];

const PREFIX = 'com.diy.obs.';
const FOLLOW = '@switcher';
const DEFAULTS = {
    track: { input: '', style: 'bars', icon: 'auto', step: 1 },        // key + knob; input '' = first audio input, FOLLOW = the Track Switcher pick
    switcher: { inputs: [], style: 'bars' },                          // key + knob; inputs empty = every audio input
    duo: { a: '', b: '' },
    stream: {},
    record: {},
    scene: { scene: '', more: [] },                                   // more: up to 3 extra scenes, a tap moves through them
    scenesw: { scenes: [] },                                          // key + knob; scenes empty = every scene
    mic: { input: '' },
    vcam: {},
    replay: {},
    screenshot: {},
    studio: {},
    stats: {},
    source: { scene: '', source: '' },
};
const HOLD_MS = 500;
const HOT_MS = 1500;
const FLASH_MS = 1200;
const RECONNECT_MS = 3000;
const METER_KINDS = new Set(['track', 'switcher', 'duo']);

// ---------- state ----------
const contexts = new Map();  // context -> { kind, knob, settings, lastSvg, timer, held, multiDone, flash }
const inspectors = new Map(); // context -> action (open settings windows)
let conn = { host: '127.0.0.1', port: 4455, password: '' };
let switcherSel = '';
let sceneSel = '';
const obs = {
    status: 'connecting',   // connecting | connected | error
    error: '',
    inputs: new Map(),      // name -> { name, kind, vol, muted, lvl, peak, peakAt, vu, meterAt }
    audio: [],              // audio input names in OBS order
    scenes: [], program: '', preview: '', studio: false,
    stream: { active: false, state: 'off', reconnecting: false, t: 0, bytes: 0, kbps: null, drop: null, lastBytes: 0, lastAt: 0, syncAt: 0 },
    record: { state: 'off', t: 0, bytes: null, syncAt: 0 },
    vcam: false,
    replay: { active: false, available: true },
    stats: { fps: null, cpu: null, drop: null },
    items: new Map(),       // "scene\nsource" -> { id, enabled }
};
const hot = new Map();      // input name -> until (ms)

// ---------- Stream Dock ----------
const sd = new WebSocket('ws://127.0.0.1:' + port);
const send = (o) => { if (sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(o)); };

sd.on('open', () => {
    send({ event: registerEvent, uuid: pluginUUID });
    send({ event: 'getGlobalSettings', context: pluginUUID });
    log('registered');
});
sd.on('close', () => process.exit(0));
sd.on('error', e => log('sd error', String(e)));
sd.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
    const { event, action, context, payload } = m;
    const kind = action && action.startsWith(PREFIX) ? action.slice(PREFIX.length) : null;
    switch (event) {
        case 'didReceiveGlobalSettings': {
            const g = (payload && payload.settings) || {};
            const next = { host: String(g.host || '127.0.0.1'), port: +g.port || 4455, password: String(g.password || '') };
            if (typeof g.switcherSel === 'string') switcherSel = g.switcherSel;
            if (typeof g.sceneSel === 'string') sceneSel = g.sceneSel;
            const changed = next.host !== conn.host || next.port !== conn.port || next.password !== conn.password;
            conn = next;
            if (changed || !client) connect();
            break;
        }
        case 'willAppear':
            if (!DEFAULTS[kind]) return;
            contexts.set(context, { kind, knob: !!(payload && payload.controller === 'Knob'),
                settings: Object.assign({}, DEFAULTS[kind], payload && payload.settings), lastSvg: null });
            onKeysChanged();
            draw(context, true);
            break;
        case 'willDisappear':
            contexts.delete(context);
            onKeysChanged();
            break;
        case 'didReceiveSettings':
            setSettings(context, payload && payload.settings);
            break;
        case 'propertyInspectorDidAppear':
            inspectors.set(context, action);
            sendState(context, action);
            break;
        case 'propertyInspectorDidDisappear':
            inspectors.delete(context);
            break;
        case 'sendToPlugin':
            if (!payload) return;
            if (payload.type === 'hello') { inspectors.set(context, action); sendState(context, action); }
            else if (payload.type === 'settings') setSettings(context, payload.settings);
            else if (payload.type === 'connection') {
                conn = { host: String(payload.host || '127.0.0.1').trim(), port: +payload.port || 4455, password: String(payload.password || '') };
                saveGlobal();
                connect();
            }
            else if (payload.type === 'sources') sendSources(context, action, String(payload.scene || ''));
            break;
        case 'keyDown': pressDown(context, payload || {}); break;
        case 'keyUp': pressUp(context, payload || {}); break;
        case 'dialDown': pressDown(context, {}); break;
        case 'dialUp': pressUp(context, {}); break;
        case 'dialPress': (payload && payload.pressed === false ? pressUp : pressDown)(context, {}); break; // older SDKs
        case 'dialRotate': rotate(context, (payload && payload.ticks) || 0); break;
    }
});

function setSettings(context, s) {
    const c = contexts.get(context);
    if (!c || !s) return;
    c.settings = Object.assign({}, DEFAULTS[c.kind], s);
    if (c.kind === 'source') resolveItem(c.settings.scene, c.settings.source);
    onKeysChanged();
    draw(context, true);
}
function saveGlobal() {
    send({ event: 'setGlobalSettings', context: pluginUUID, payload: { host: conn.host, port: conn.port, password: conn.password, switcherSel, sceneSel } });
}
function onKeysChanged() {
    updateSubscriptions();
    for (const c of contexts.values()) if (c.kind === 'source') resolveItem(c.settings.scene, c.settings.source);
}

// ---------- obs-websocket v5 client ----------
const OP = { Hello: 0, Identify: 1, Identified: 2, Reidentify: 3, Event: 5, Request: 6, RequestResponse: 7 };
const EVENTS_ALL = 0x7FF, EVENTS_METERS = 1 << 16;
let client = null, reconnectTimer = null, reqId = 0, subscribed = -1;
const waiting = new Map(); // requestId -> { resolve, reject, timer }

function connect() {
    clearTimeout(reconnectTimer);
    if (client) { try { client.removeAllListeners(); client.terminate(); } catch (_) {} }
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error('disconnected')); }
    waiting.clear();
    subscribed = -1;
    setStatus('connecting', '');
    const url = `ws://${conn.host.includes(':') && !conn.host.startsWith('[') ? '[' + conn.host + ']' : conn.host}:${conn.port}`;
    let ws;
    try { ws = new WebSocket(url, 'obswebsocket.json', { handshakeTimeout: 4000 }); } catch (e) { return fail('Bad address: ' + conn.host); }
    client = ws;
    ws.on('message', raw => {
        let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
        const d = m.d || {};
        switch (m.op) {
            case OP.Hello: {
                const id = { rpcVersion: 1, eventSubscriptions: wantedEvents() };
                if (d.authentication) {
                    if (!conn.password) { ws.close(); return fail('OBS asks for a password'); }
                    const secret = crypto.createHash('sha256').update(conn.password + d.authentication.salt).digest('base64');
                    id.authentication = crypto.createHash('sha256').update(secret + d.authentication.challenge).digest('base64');
                }
                subscribed = id.eventSubscriptions;
                ws.send(JSON.stringify({ op: OP.Identify, d: id }));
                break;
            }
            case OP.Identified:
                if (online()) return; // OBS answers a Reidentify with Identified too
                log('obs connected', url);
                setStatus('connected', '');
                syncAll().catch(e => log('sync', String(e)));
                break;
            case OP.Event: onObsEvent(d.eventType, d.eventData || {}); break;
            case OP.RequestResponse: {
                const w = waiting.get(d.requestId);
                if (!w) return;
                waiting.delete(d.requestId); clearTimeout(w.timer);
                if (d.requestStatus && d.requestStatus.result) w.resolve(d.responseData || {});
                else w.reject(Object.assign(new Error((d.requestStatus && d.requestStatus.comment) || d.requestType + ' failed'), { code: d.requestStatus && d.requestStatus.code }));
                break;
            }
        }
    });
    ws.on('error', e => {
        const msg = String(e && e.code || e && e.message || e);
        if (/ECONNREFUSED/.test(msg)) obs.error = 'OBS is not running, or its WebSocket server is off';
        else if (/ENOTFOUND|EAI_AGAIN/.test(msg)) obs.error = 'Address not found: ' + conn.host;
        else obs.error = msg;
    });
    ws.on('close', (code) => {
        if (client !== ws) return;
        if (code === 4009) obs.error = 'Wrong password';
        else if (code === 4010) obs.error = 'OBS WebSocket is too old. Use OBS 28 or newer';
        const was = obs.status;
        fail(obs.error || 'Disconnected');
        if (was === 'connected') log('obs disconnected', code);
    });
}
function fail(msg) {
    setStatus('error', msg);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
}
function setStatus(status, error) {
    const changed = obs.status !== status || obs.error !== error;
    obs.status = status; obs.error = error;
    if (status !== 'connected') {
        obs.stream.state = 'off'; obs.record.state = 'off';
    }
    if (changed) { drawAll(); broadcast(); }
}
const online = () => obs.status === 'connected';
function request(requestType, requestData) {
    return new Promise((resolve, reject) => {
        if (!client || client.readyState !== WebSocket.OPEN || !online()) return reject(new Error('OBS not connected'));
        const requestId = 'r' + (++reqId);
        const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(requestType + ' timed out')); }, 5000);
        waiting.set(requestId, { resolve, reject, timer });
        client.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, requestData } }));
    });
}
const tryReq = (type, data) => request(type, data).catch(e => { log(type, String(e.message || e)); return null; });

// Live levels are a high-volume event: only ask for them while a key shows a meter.
function wantedEvents() {
    const meters = [...contexts.values()].some(c => METER_KINDS.has(c.kind));
    return EVENTS_ALL | (meters ? EVENTS_METERS : 0);
}
function updateSubscriptions() {
    if (!online() || !client) return;
    const want = wantedEvents();
    if (want === subscribed) return;
    subscribed = want;
    client.send(JSON.stringify({ op: OP.Reidentify, d: { eventSubscriptions: want } }));
}

// ---------- reading OBS state ----------
async function syncAll() {
    await Promise.all([syncInputs(), syncScenes(), syncOutputs()]);
    for (const c of contexts.values()) if (c.kind === 'source') resolveItem(c.settings.scene, c.settings.source, true);
    updateSubscriptions();
    drawAll(); broadcast();
}
async function syncInputs() {
    const r = await tryReq('GetInputList');
    if (!r) return;
    const list = r.inputs || [];
    // an input has audio when OBS can report its volume
    const vols = await Promise.all(list.map(i => request('GetInputVolume', { inputName: i.inputName }).catch(() => null)));
    const mutes = await Promise.all(list.map((i, n) => vols[n] ? request('GetInputMute', { inputName: i.inputName }).catch(() => null) : null));
    const next = new Map(), audio = [];
    list.forEach((i, n) => {
        if (!vols[n]) return;
        const old = obs.inputs.get(i.inputName) || {};
        next.set(i.inputName, { name: i.inputName, kind: i.inputKind || '', vol: vols[n].inputVolumeDb, muted: !!(mutes[n] && mutes[n].inputMuted),
            lvl: old.lvl != null ? old.lvl : -100, peak: old.peak != null ? old.peak : -100, peakAt: 0, vu: old.vu != null ? old.vu : -60, meterAt: 0 });
        audio.push(i.inputName);
    });
    obs.inputs = next; obs.audio = audio;
}
async function syncScenes() {
    const [r, st] = await Promise.all([tryReq('GetSceneList'), tryReq('GetStudioModeEnabled')]);
    if (r) {
        obs.scenes = (r.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map(s => s.sceneName); // OBS lists scenes bottom-up
        obs.program = r.currentProgramSceneName || '';
        obs.preview = r.currentPreviewSceneName || '';
    }
    if (st) obs.studio = !!st.studioModeEnabled;
}
async function syncOutputs() {
    const [s, r, v, b] = await Promise.all([tryReq('GetStreamStatus'), tryReq('GetRecordStatus'), tryReq('GetVirtualCamStatus'),
        request('GetReplayBufferStatus').catch(() => null)]);
    if (s) applyStream(s);
    if (r) applyRecord(r);
    if (v) obs.vcam = !!v.outputActive;
    obs.replay = b ? { active: !!b.outputActive, available: true } : { active: false, available: false };
}
function applyStream(s) {
    const st = obs.stream, now = Date.now();
    st.active = !!s.outputActive;
    st.reconnecting = !!s.outputReconnecting;
    if (st.active && st.state !== 'stopping') st.state = 'live';
    if (!st.active && st.state === 'live') st.state = 'off';
    st.t = (s.outputDuration || 0) / 1000; st.syncAt = now;
    if (s.outputTotalFrames) st.drop = 100 * (s.outputSkippedFrames || 0) / s.outputTotalFrames; else st.drop = st.active ? 0 : null;
    if (st.active && st.lastAt && s.outputBytes >= st.lastBytes && now > st.lastAt) st.kbps = (s.outputBytes - st.lastBytes) * 8 / (now - st.lastAt); // bytes per ms * 8 = kbit/s
    st.lastBytes = s.outputBytes || 0; st.lastAt = now;
    if (!st.active) { st.kbps = null; st.lastAt = 0; }
}
function applyRecord(r) {
    const rec = obs.record;
    if (rec.state !== 'starting' && rec.state !== 'stopping') rec.state = r.outputActive ? (r.outputPaused ? 'paused' : 'rec') : 'off';
    rec.t = (r.outputDuration || 0) / 1000; rec.syncAt = Date.now();
    rec.bytes = r.outputBytes != null ? r.outputBytes : null;
}
async function resolveItem(scene, source, force) {
    if (!scene || !source || !online()) return;
    const key = scene + '\n' + source;
    if (obs.items.has(key) && !force) return;
    obs.items.set(key, { id: null, enabled: false, missing: false });
    const r = await request('GetSceneItemId', { sceneName: scene, sourceName: source }).catch(() => null);
    if (!r) { obs.items.set(key, { id: null, enabled: false, missing: true }); return drawKind('source'); }
    const e = await tryReq('GetSceneItemEnabled', { sceneName: scene, sceneItemId: r.sceneItemId });
    obs.items.set(key, { id: r.sceneItemId, enabled: !!(e && e.sceneItemEnabled), missing: false });
    drawKind('source');
}

// ---------- OBS events ----------
function onObsEvent(type, d) {
    switch (type) {
        case 'InputVolumeMeters': return onMeters(d.inputs || []);
        case 'InputVolumeChanged': { const i = obs.inputs.get(d.inputName); if (i) { i.vol = d.inputVolumeDb; drawInput(d.inputName); } return; }
        case 'InputMuteStateChanged': { const i = obs.inputs.get(d.inputName); if (i) { i.muted = !!d.inputMuted; drawInput(d.inputName); } return; }
        case 'InputCreated': case 'InputRemoved': case 'InputNameChanged':
            if (type === 'InputNameChanged') renameInput(d.oldInputName, d.inputName);
            return syncInputs().then(() => { drawAll(); broadcast(); });
        case 'CurrentProgramSceneChanged': obs.program = d.sceneName; drawKind('scenesw'); return drawKind('scene');
        case 'CurrentPreviewSceneChanged': obs.preview = d.sceneName; drawKind('scenesw'); return drawKind('scene');
        case 'SceneListChanged': case 'SceneCreated': case 'SceneRemoved':
            obs.items.clear();
            return syncScenes().then(() => { for (const c of contexts.values()) if (c.kind === 'source') resolveItem(c.settings.scene, c.settings.source); drawAll(); broadcast(); });
        case 'SceneNameChanged': renameScene(d.oldSceneName, d.sceneName); return syncScenes().then(() => { drawAll(); broadcast(); });
        case 'StudioModeStateChanged': obs.studio = !!d.studioModeEnabled; if (!obs.studio) obs.preview = ''; else tryReq('GetCurrentPreviewScene').then(r => { if (r) { obs.preview = r.currentPreviewSceneName || r.sceneName || ''; drawKind('scene'); } }); drawKind('scene'); return drawKind('studio');
        case 'StreamStateChanged': {
            const st = obs.stream, s = d.outputState || '';
            if (/STARTING/.test(s)) st.state = 'starting';
            else if (/STOPPING/.test(s)) st.state = 'stopping';
            else if (/RECONNECTING/.test(s)) st.reconnecting = true;
            else if (/RECONNECTED/.test(s)) st.reconnecting = false;
            else if (/STARTED/.test(s)) { st.state = 'live'; st.active = true; st.t = 0; st.syncAt = Date.now(); st.lastAt = 0; st.drop = 0; }
            else if (/STOPPED/.test(s)) { st.state = 'off'; st.active = false; st.reconnecting = false; st.kbps = null; }
            return drawKind('stream');
        }
        case 'RecordStateChanged': {
            const rec = obs.record, s = d.outputState || '';
            if (/STARTING/.test(s)) rec.state = 'starting';
            else if (/STOPPING/.test(s)) rec.state = 'stopping';
            else if (/STARTED/.test(s)) { rec.state = 'rec'; rec.t = 0; rec.syncAt = Date.now(); rec.bytes = 0; }
            else if (/RESUMED/.test(s)) rec.state = 'rec';
            else if (/PAUSED/.test(s)) rec.state = 'paused';
            else if (/STOPPED/.test(s)) rec.state = 'off';
            if (rec.state === 'rec' || rec.state === 'paused') tryReq('GetRecordStatus').then(r => { if (r) { applyRecord(r); drawKind('record'); } });
            return drawKind('record');
        }
        case 'VirtualcamStateChanged': obs.vcam = !!d.outputActive; return drawKind('vcam');
        case 'ReplayBufferStateChanged': obs.replay.active = !!d.outputActive; obs.replay.available = true; return drawKind('replay');
        case 'ReplayBufferSaved': return flashKind('replay', 'SAVED');
        case 'SceneItemEnableStateChanged':
            for (const [k, v] of obs.items) if (k.startsWith(d.sceneName + '\n') && v.id === d.sceneItemId) v.enabled = !!d.sceneItemEnabled;
            return drawKind('source');
        case 'SceneItemCreated': case 'SceneItemRemoved':
            for (const k of [...obs.items.keys()]) if (k.startsWith(d.sceneName + '\n')) obs.items.delete(k);
            for (const c of contexts.values()) if (c.kind === 'source') resolveItem(c.settings.scene, c.settings.source);
            return;
        case 'ExitStarted': log('OBS is closing'); return;
    }
}
const VU_REF = 18;
const mulToDb = m => m > 0 ? 20 * Math.log10(m) : -100;
function onMeters(list) {
    const now = Date.now();
    for (const m of list) {
        const i = obs.inputs.get(m.inputName);
        if (!i) continue;
        let peak = 0, mag = 0;
        for (const ch of m.inputLevelsMul || []) { peak = Math.max(peak, ch[1] || 0); mag = Math.max(mag, ch[0] || 0); }
        const db = mulToDb(peak), mdb = mulToDb(mag);
        i.lvl = Math.max(db, (i.lvl != null ? i.lvl : -100) - 1.5); // fast attack, slow fall
        if (i.lvl >= i.peak || now - i.peakAt > 1500) { i.peak = i.lvl; i.peakAt = now; }
        i.vu += (Math.max(-45, mdb + VU_REF) - i.vu) * 0.3;       // needle ballistics; 0 VU = -18 dBFS RMS like studio gear
        i.meterAt = now;
    }
}
function renameInput(from, to) {
    let save = false;
    for (const [ctx, c] of contexts) {
        const s = c.settings; let ch = false;
        for (const k of ['input', 'a', 'b']) if (s[k] === from) { s[k] = to; ch = true; }
        if (Array.isArray(s.inputs) && s.inputs.includes(from)) { s.inputs = s.inputs.map(x => x === from ? to : x); ch = true; }
        if (ch) send({ event: 'setSettings', context: ctx, payload: s });
    }
    if (switcherSel === from) { switcherSel = to; save = true; }
    if (save) saveGlobal();
}
function renameScene(from, to) {
    for (const [ctx, c] of contexts) {
        const st = c.settings; let ch = false;
        if (st.scene === from) { st.scene = to; ch = true; }
        for (const k of ['more', 'scenes']) if (Array.isArray(st[k]) && st[k].includes(from)) { st[k] = st[k].map(x => x === from ? to : x); ch = true; }
        if (ch) send({ event: 'setSettings', context: ctx, payload: st });
    }
    if (sceneSel === from) { sceneSel = to; saveGlobal(); }
    obs.items.clear();
}

// ---------- switcher ----------
function switchList() {
    const sw = [...contexts.values()].find(c => c.kind === 'switcher');
    const wanted = sw && Array.isArray(sw.settings.inputs) ? sw.settings.inputs.filter(n => obs.inputs.has(n)) : [];
    return wanted.length ? wanted : obs.audio.slice();
}
function switchCurrent() {
    const list = switchList();
    if (!list.length) return { list, i: -1, name: '' };
    let i = list.indexOf(switcherSel);
    if (i < 0) i = 0;
    return { list, i, name: list[i] };
}
function switchMove(d) {
    const { list, i } = switchCurrent();
    if (!list.length) return false;
    switcherSel = list[(i + d + list.length) % list.length];
    saveGlobal();
    hot.set(switcherSel, Date.now() + HOT_MS);
    drawAll();
    return true;
}
// ---------- scenes ----------
// Scene key: its own list (1 to 4 scenes). Shows the one on air, else the one in preview, else the first.
function sceneList(s) {
    const all = [s.scene].concat(Array.isArray(s.more) ? s.more : []).filter(Boolean);
    return all.filter((n, i) => all.indexOf(n) === i);
}
function sceneShown(list) {
    if (list.includes(obs.program)) return obs.program;
    if (obs.studio && list.includes(obs.preview)) return obs.preview;
    return list[0] || '';
}
// Send a scene to air: in Studio Mode to preview first, and a second press on the previewed scene makes the transition.
function goScene(name, context) {
    if (!name || !obs.scenes.includes(name)) return alert(context);
    if (obs.studio) {
        if (obs.preview === name && obs.program !== name) return ok(context, request('TriggerStudioModeTransition'));
        return ok(context, request('SetCurrentPreviewScene', { sceneName: name }));
    }
    return ok(context, request('SetCurrentProgramScene', { sceneName: name }));
}
function sceneTap(s, context) {
    const list = sceneList(s).filter(n => obs.scenes.includes(n));
    if (!list.length) return alert(context);
    if (list.length === 1) return goScene(list[0], context);
    if (obs.studio && list.includes(obs.preview) && obs.preview !== obs.program) return goScene(obs.preview, context); // finish the transition first
    const cur = list.indexOf(sceneShown(list));
    return goScene(list[(cur + 1) % list.length], context);
}
// Scene Switcher: shared pick, like the Track Switcher
function sceneSwList() {
    const sw = [...contexts.values()].find(c => c.kind === 'scenesw');
    const wanted = sw && Array.isArray(sw.settings.scenes) ? sw.settings.scenes.filter(n => obs.scenes.includes(n)) : [];
    return wanted.length ? wanted : obs.scenes.slice();
}
function sceneSwCurrent() {
    const list = sceneSwList();
    if (!list.length) return { list, i: -1, name: '' };
    let i = list.indexOf(sceneSel);
    if (i < 0) i = Math.max(0, list.indexOf(obs.program));
    return { list, i, name: list[i] };
}
function sceneSwMove(d) {
    const { list, i } = sceneSwCurrent();
    if (!list.length) return false;
    sceneSel = list[(i + d + list.length) % list.length];
    saveGlobal();
    drawKind('scenesw');
    return true;
}

const trackInput = (s) => s.input === FOLLOW ? switchCurrent().name : (s.input || obs.audio[0] || '');

// ---------- actions ----------
function pressDown(context, payload) {
    const c = contexts.get(context);
    if (!c) return;
    if (payload.isInMultiAction) { c.multiDone = true; tap(c, context); return; } // no hold inside a Multi Action
    c.held = false; c.multiDone = false;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => { c.held = true; hold(c, context); }, HOLD_MS);
}
function pressUp(context, payload) {
    const c = contexts.get(context);
    if (!c) return;
    clearTimeout(c.timer);
    if (c.multiDone) { c.multiDone = false; return; }
    if (payload.isInMultiAction || !c.held) tap(c, context);
}
const alert = (context) => send({ event: 'showAlert', context });
const ok = (context, p) => p.then(() => true).catch(e => { log('action', String(e.message || e)); alert(context); return false; });

function toggleMute(name, context) {
    if (!name || !obs.inputs.has(name)) return alert(context);
    hot.set(name, Date.now() + HOT_MS);
    ok(context, request('ToggleInputMute', { inputName: name }));
}
function turn(name, ticks, step, context) {
    const i = obs.inputs.get(name);
    if (!i) return alert(context);
    let v = i.vol <= -60 ? (ticks > 0 ? -60 : -100) : i.vol;
    if (v > -100) v = Math.round(v + ticks * step);
    if (v < -60) v = -100;           // below -60 dB is silence: set -inf like the OBS fader
    v = Math.min(0, v);
    i.vol = v;                       // show it now; OBS confirms with InputVolumeChanged
    hot.set(name, Date.now() + HOT_MS);
    if (i.muted && ticks > 0) request('SetInputMute', { inputName: name, inputMuted: false }).catch(() => {});
    request('SetInputVolume', { inputName: name, inputVolumeDb: v }).catch(e => log('vol', String(e.message || e)));
    drawInput(name);
}
function rotate(context, ticks) {
    const c = contexts.get(context);
    if (!c || !ticks) return;
    if (!online()) return alert(context);
    const s = c.settings, step = Math.max(1, Math.min(6, +s.step || 1));
    if (c.kind === 'track') turn(trackInput(s), ticks, step, context);
    else if (c.kind === 'switcher') switchMove(ticks > 0 ? 1 : -1) || alert(context);
    else if (c.kind === 'scenesw') sceneSwMove(ticks > 0 ? 1 : -1) || alert(context);
}
function tap(c, context) {
    if (!online()) return alert(context);
    const s = c.settings;
    switch (c.kind) {
        case 'track': return toggleMute(trackInput(s), context);
        case 'switcher':
            if (c.knob) return toggleMute(switchCurrent().name, context);
            return switchMove(1) || alert(context);
        case 'duo': return toggleMute(duoInputs(s)[0], context);
        case 'mic': return toggleMute(s.input, context);
        case 'stream':
            if (obs.stream.state === 'live') { flash(context, 'HOLD TO STOP'); return; } // a stray tap never ends the stream
            if (obs.stream.state === 'off') return ok(context, request('StartStream'));
            return;
        case 'record': {
            const st = obs.record.state;
            if (st === 'off') return ok(context, request('StartRecord'));
            if (st === 'rec') return ok(context, request('PauseRecord'));
            if (st === 'paused') return ok(context, request('ResumeRecord'));
            return;
        }
        case 'scene': return sceneTap(s, context);
        case 'scenesw': return goScene(sceneSwCurrent().name, context);
        case 'vcam': return ok(context, request('ToggleVirtualCam'));
        case 'replay':
            if (!obs.replay.available) { flash(context, 'OFF IN OBS'); return alert(context); }
            return ok(context, request(obs.replay.active ? 'SaveReplayBuffer' : 'StartReplayBuffer'));
        case 'screenshot': return screenshot(context);
        case 'studio': return ok(context, request('SetStudioModeEnabled', { studioModeEnabled: !obs.studio }));
        case 'source': {
            const it = obs.items.get(s.scene + '\n' + s.source);
            if (!it || it.id == null) return alert(context);
            return ok(context, request('SetSceneItemEnabled', { sceneName: s.scene, sceneItemId: it.id, sceneItemEnabled: !it.enabled }));
        }
    }
}
function hold(c, context) {
    if (!online()) return alert(context);
    const s = c.settings;
    switch (c.kind) {
        case 'switcher': return toggleMute(switchCurrent().name, context);
        case 'duo': return toggleMute(duoInputs(s)[1], context);
        case 'stream':
            if (obs.stream.active) return ok(context, request('StopStream'));
            return ok(context, request('StartStream'));
        case 'record':
            if (obs.record.state === 'rec' || obs.record.state === 'paused') return ok(context, request('StopRecord'));
            return ok(context, request('StartRecord'));
        case 'scene': case 'scenesw': {
            // hold = straight to air, also in Studio Mode
            const name = c.kind === 'scenesw' ? sceneSwCurrent().name : sceneShown(sceneList(s).filter(n => obs.scenes.includes(n)));
            if (!name) return alert(context);
            return ok(context, request('SetCurrentProgramScene', { sceneName: name }));
        }
        case 'replay':
            if (!obs.replay.available) return alert(context);
            return ok(context, request('ToggleReplayBuffer'));
    }
    tap(c, context); // for other actions a hold is a normal press
}
async function screenshot(context) {
    const scene = obs.program;
    const dir = await tryReq('GetRecordDirectory');
    if (!scene || !dir || !dir.recordDirectory) return alert(context);
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `Screenshot ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
    const sep = dir.recordDirectory.includes('\\') ? '\\' : '/';
    const file = dir.recordDirectory.replace(/[\\/]+$/, '') + sep + name;
    if (await ok(context, request('SaveSourceScreenshot', { sourceName: scene, imageFormat: 'png', imageFilePath: file }))) flash(context, 'SAVED');
}
function duoInputs(s) {
    const a = s.a && obs.inputs.has(s.a) ? s.a : (!s.a ? obs.audio[0] : '');
    const b = s.b && obs.inputs.has(s.b) ? s.b : (!s.b ? obs.audio.find(n => n !== a) : '');
    return [a || '', b || ''];
}
function flash(context, msg) {
    const c = contexts.get(context);
    if (!c) return;
    c.flash = { msg, until: Date.now() + FLASH_MS };
    draw(context);
    setTimeout(() => draw(context), FLASH_MS + 50);
}
function flashKind(kind, msg) { for (const [ctx, c] of contexts) if (c.kind === kind) flash(ctx, msg); }

// ---------- drawing ----------
const ICON_RULES = [
    [/mic|aux|voice|vocal/i, 'mic'], [/music|spotify|song|track|radio|bg/i, 'music'], [/alert|donat|notif|tts|bell/i, 'bell'],
    [/discord|chat|team|zoom|skype/i, 'chat'], [/game|play|steam/i, 'game'], [/desktop|system|pc/i, 'desktop'],
];
function iconFor(name, kind, pick) {
    if (pick && pick !== 'auto') return pick;
    for (const [re, ic] of ICON_RULES) if (re.test(name)) return ic;
    if (/input_capture|input/.test(kind)) return 'mic';
    if (/process_output|game_capture/.test(kind)) return 'game';
    if (/output_capture/.test(kind)) return 'desktop';
    if (/ffmpeg|vlc|media/.test(kind)) return 'music';
    if (/browser/.test(kind)) return 'bell';
    return 'speaker';
}
function trackData(name, pick) {
    const i = name && obs.inputs.get(name);
    if (!i) return null;
    const fresh = Date.now() - i.meterAt < 400;
    return { name: shortName(i.name), icon: iconFor(i.name, i.kind, pick), vol: i.vol <= -100 ? -100 : i.vol, muted: i.muted,
        lvl: fresh ? i.lvl : -100, peak: fresh ? i.peak : -100, vu: fresh ? i.vu : -60 };
}
const isHot = (name) => !!name && (hot.get(name) || 0) > Date.now();
function live(sec, syncAt, running) { return sec + (running && syncAt ? (Date.now() - syncAt) / 1000 : 0); }

function image(c) {
    const s = c.settings, off = !online(), now = Date.now();
    if (c.flash && c.flash.until > now) {
        const ic = { replay: 'replay', screenshot: 'camera', stream: 'antenna' }[c.kind] || 'mixer';
        const name = { replay: 'REPLAY', screenshot: 'SCREENSHOT', stream: 'STREAM' }[c.kind] || '';
        return R.flash({ icon: ic, name, msg: c.flash.msg });
    }
    switch (c.kind) {
        case 'track': {
            const name = trackInput(s), tr = off ? offTrack(name, s.icon) : trackData(name, s.icon);
            const sw = s.input === FOLLOW ? switchCurrent() : null;
            const o = { offline: off, hot: isHot(name), dots: sw && sw.list.length > 1 ? { i: sw.i, n: sw.list.length } : null };
            return s.style === 'vu' ? R.vu(tr, o) : R.track(tr, o);
        }
        case 'switcher': {
            const sw = switchCurrent(), tr = off ? offTrack(sw.name) : trackData(sw.name);
            const o = { offline: off, hot: isHot(sw.name), dots: { i: sw.i, n: sw.list.length }, title: 'SWITCHER' };
            return s.style === 'vu' ? R.vu(tr, o) : R.track(tr, o);
        }
        case 'duo': {
            const [a, b] = duoInputs(s);
            const A = off ? offTrack(a) : trackData(a), B = off ? offTrack(b) : trackData(b);
            return R.duo(A, B, { offline: off, hot: isHot(a) ? 0 : isHot(b) ? 1 : null });
        }
        case 'mic': { const i = obs.inputs.get(s.input); return R.mic({ name: s.input ? shortName(s.input) : '', muted: !!(i && i.muted), offline: off }); }
        case 'stream': {
            const st = obs.stream;
            return R.stream({ offline: off, state: st.state, reconnecting: st.reconnecting, t: live(st.t, st.syncAt, st.state === 'live'), kbps: st.kbps, drop: st.drop });
        }
        case 'record': {
            const r = obs.record;
            return R.record({ offline: off, state: r.state, t: live(r.t, r.syncAt, r.state === 'rec'), bytes: r.bytes, blink: Math.floor(now / 600) % 2 === 0 });
        }
        case 'scene': {
            const list = sceneList(s), name = sceneShown(list.filter(n => obs.scenes.includes(n))) || list[0] || '';
            const missing = !off && !!name && obs.scenes.length > 0 && !obs.scenes.includes(name);
            const role = name === obs.program ? 'program' : obs.studio && name === obs.preview ? 'preview' : '';
            return R.scene({ name, role, offline: off, missing, dots: list.length > 1 ? { i: Math.max(0, list.indexOf(name)), n: list.length } : null });
        }
        case 'scenesw': {
            const sw = sceneSwCurrent(), name = sw.name;
            const role = name === obs.program ? 'program' : obs.studio && name === obs.preview ? 'preview' : '';
            return R.scene({ name, role, offline: off, dots: sw.list.length > 1 ? { i: sw.i, n: sw.list.length } : null });
        }
        case 'vcam': {
            const pulse = (Math.sin(now / 2200 * 2 * Math.PI) + 1) / 2;
            return R.led({ icon: 'webcam', name: 'VIRTUAL CAM', caption: obs.vcam ? 'ON' : 'OFF', color: R.COLORS.BLUE, on: obs.vcam, pulse, crossed: true, offline: off });
        }
        case 'replay':
            return R.led({ icon: 'replay', name: 'REPLAY', caption: !obs.replay.available ? 'OFF IN OBS' : obs.replay.active ? 'TAP TO SAVE' : 'TAP TO START', color: R.COLORS.AMBER, on: obs.replay.active, offline: off });
        case 'screenshot':
            return R.led({ icon: 'camera', name: 'SCREENSHOT', caption: 'TAP TO SAVE', color: R.COLORS.AMBER, on: false, offline: off });
        case 'studio':
            return R.led({ icon: 'studio', name: 'STUDIO MODE', caption: obs.studio ? 'ON' : 'OFF', color: R.COLORS.GREEN, on: obs.studio, offline: off });
        case 'stats':
            return R.stats(Object.assign({ offline: off }, obs.stats));
        case 'source': {
            if (!s.scene || !s.source) return R.idle({ icon: 'eye', name: 'SOURCE', caption: off ? 'OBS OFFLINE' : 'SET UP', offline: off });
            const it = obs.items.get(s.scene + '\n' + s.source);
            if (!off && it && it.missing) return R.idle({ icon: 'eye', name: s.source, caption: 'NOT FOUND', captionColor: R.COLORS.RED, offline: false });
            const on = !!(it && it.enabled);
            return R.led({ icon: 'eye', name: s.source, caption: on ? 'VISIBLE' : 'HIDDEN', color: R.COLORS.GREEN, on, crossed: true, offline: off });
        }
    }
    return R.idle({ icon: 'mixer', name: 'OBS DECK', caption: '' });
}
function offTrack(name, pick) {
    return name ? { name: shortName(name), icon: iconFor(name, '', pick), vol: null, muted: false, lvl: -100, peak: -100, vu: -60 } : null;
}
const shortName = (n) => String(n).replace(/\/aux$/i, '');

function draw(context, force) {
    const c = contexts.get(context);
    if (!c) return;
    let svg;
    try { svg = image(c); } catch (e) { log('render', String(e && e.stack || e)); return; }
    if (!force && svg === c.lastSvg) return;
    c.lastSvg = svg;
    send({ event: 'setImage', context, payload: { target: 0, image: 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64') } });
}
function drawAll() { for (const ctx of contexts.keys()) draw(ctx); }
function drawKind(kind) { for (const [ctx, c] of contexts) if (c.kind === kind) draw(ctx); }
function drawInput(name) {
    for (const [ctx, c] of contexts) {
        if (c.kind === 'track' && trackInput(c.settings) === name) draw(ctx);
        else if (c.kind === 'switcher' && switchCurrent().name === name) draw(ctx);
        else if (c.kind === 'duo' && duoInputs(c.settings).includes(name)) draw(ctx);
        else if (c.kind === 'mic' && c.settings.input === name) draw(ctx);
    }
}

// Meters, timers and the breathing virtual-cam icon: about 10 frames a second, only for keys that move.
setInterval(() => {
    const now = Date.now();
    for (const i of obs.inputs.values()) if (now - i.meterAt > 400 && i.lvl > -100) { i.lvl = -100; i.peak = -100; i.vu = -60; }
    for (const [ctx, c] of contexts) {
        if (METER_KINDS.has(c.kind) || (c.kind === 'vcam' && obs.vcam) || (c.kind === 'record' && obs.record.state === 'rec') || (c.kind === 'stream' && obs.stream.state === 'live')) draw(ctx);
    }
}, 100);

// Stream and record numbers, and stats, while a key shows them.
setInterval(() => {
    if (!online()) return;
    const kinds = new Set([...contexts.values()].map(c => c.kind));
    if ((kinds.has('stream') || kinds.has('stats')) && obs.stream.active) tryReq('GetStreamStatus').then(r => { if (r) { applyStream(r); drawKind('stream'); } });
    if (kinds.has('record') && (obs.record.state === 'rec' || obs.record.state === 'paused')) tryReq('GetRecordStatus').then(r => { if (r) { applyRecord(r); drawKind('record'); } });
    if (kinds.has('stats')) tryReq('GetStats').then(r => {
        if (!r) return;
        const drop = obs.stream.active && obs.stream.drop != null ? obs.stream.drop : (r.renderTotalFrames ? 100 * (r.renderSkippedFrames || 0) / r.renderTotalFrames : 0);
        obs.stats = { fps: r.activeFps, cpu: r.cpuUsage, drop };
        drawKind('stats');
    });
}, 2000);

// ---------- settings window ----------
function sendState(context, action) {
    send({ event: 'sendToPropertyInspector', action, context, payload: {
        type: 'state',
        conn: { host: conn.host, port: conn.port, password: conn.password, status: obs.status, error: obs.error },
        inputs: obs.audio.map(n => { const i = obs.inputs.get(n); return { name: n, kind: i.kind, icon: iconFor(n, i.kind) }; }),
        scenes: obs.scenes,
        switcher: switchCurrent().name,
        sceneSel: sceneSwCurrent().name,
    } });
}
let broadcastTimer = null;
function broadcast() {
    clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => { for (const [ctx, action] of inspectors) sendState(ctx, action); }, 100);
}
async function sendSources(context, action, scene) {
    const r = scene && online() ? await tryReq('GetSceneItemList', { sceneName: scene }) : null;
    const sources = r ? (r.sceneItems || []).map(i => i.sourceName) : [];
    send({ event: 'sendToPropertyInspector', action, context, payload: { type: 'sources', scene, sources } });
}

// connect with the defaults if Stream Dock has no saved connection yet
setTimeout(() => { if (!client) connect(); }, 2000);
