/*
 * tt-halloween.js - Halloween creatures on TT, TD and IPT, October 2026 (the same file on all three).
 *
 * Spiders, bats, ghosts and friends come in from the edges of the screen at random moments and leave again.
 * Clicking one banishes it, each kind in its own way; now and then a click makes it leap at the viewer instead.
 *
 * Loaded only by tt-halloween-boot.js (one <script> line in /srv/<site>/templates/header.tpl, with data-site on
 * TD and IPT). The loader stops after 31 October (the visitor's own clock), waits until the page has finished
 * loading and keeps this file in localStorage, so it is downloaded once per version instead of on every page.
 *
 * The site itself is not touched: everything is drawn in one shadow root laid over the page, the site's CSS cannot
 * reach in, nothing here leaks out, and the layer lets every click through except on a creature. Between
 * encounters nothing runs at all: the animation loop stops itself when the stage is empty.
 *
 * Moderators can open the creature lab with #spooky-lab on any page (summon any creature, force a jump scare).
 */
(function () {
'use strict';
if (window.__tthLive || !document.body || !document.documentElement.attachShadow || !Element.prototype.animate) return;
window.__tthLive = true;

/* ------------------------------------------------------------------------------------------------ basics */

const CFG = Object.assign({ end: Infinity, lab: false, sound: true, v: '' }, window.__tthCfg || {});
const doc = document, html = doc.documentElement, TAU = Math.PI * 2, DEG = 180 / Math.PI;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const chance = p => Math.random() < p;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const hypot = Math.hypot;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const ease = {
	out: t => 1 - Math.pow(1 - t, 3),
	in: t => t * t * t,
	inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
	back: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
const n1 = v => Math.round(v * 10) / 10;        // short numbers in SVG attributes
let uidN = 0;
const uid = p => 'tth-' + p + (++uidN);

// localStorage keeps a few counters across visits (the cat's lives, when the last jump scare was), sessionStorage
// the encounter timing across pages
const store = (area, prefix) => ({
	get(k, d) { try { const v = area().getItem(prefix + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
	set(k, v) { try { area().setItem(prefix + k, JSON.stringify(v)); } catch (e) {} },
});
const keep = store(() => localStorage, 'tth.');
const sess = store(() => sessionStorage, 'tth.');

const mq = q => !!(window.matchMedia && matchMedia(q).matches);
const REDUCED = mq('(prefers-reduced-motion: reduce)');
const TOUCH = mq('(pointer: coarse)') && !mq('(pointer: fine)');
const NOW = new Date();
const HALLOWEEN = NOW.getMonth() === 9 && NOW.getDate() === 31;
const NIGHT = NOW.getHours() >= 20 || NOW.getHours() < 6;
// the visible area without the page's scrollbars (the layer covers exactly that)
const viewW = () => html.clientWidth || innerWidth, viewH = () => html.clientHeight || innerHeight;
let W = viewW(), H = viewH();
// size for this screen: a little smaller on narrow or touch screens (small), but bigger on a phone that shows a
// desktop-width page squeezed onto it (IPT has no mobile layout: ~980 px shrunk to a phone), so a creature stays
// about a fingertip's size there
function fit(small) {
	const sw = screen.width || W, squeeze = TOUCH && sw < 760 && W > sw * 1.3 ? Math.min(2.4, W / sw * .75) : 1;
	return squeeze > 1 ? squeeze : TOUCH || W < 600 ? small : 1;
}
// Visitors whose system asks for less motion (on Windows also "Show animations" switched off, often just for speed)
// get a calmer Halloween: half as many visits, no jump scares, none of the swarms. Sounds can be switched off for
// everyone in tt-halloween-boot.js.
const SOUND = CFG.sound !== false;

/* ------------------------------------------------------------------------------------------------ the stage */

const host = doc.createElement('div');
host.id = 'tt-halloween';
host.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;pointer-events:none;display:block;margin:0;padding:0;border:0;';
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = '<style></style><svg class="defs" width="0" height="0" aria-hidden="true"><defs></defs></svg>'
	+ '<div class="stage" aria-hidden="true"></div><div class="fx" aria-hidden="true"></div>'
	+ '<div class="scare" aria-hidden="true"></div><div class="ui"></div>';
const styleEl = shadow.querySelector('style'), defsEl = shadow.querySelector('defs');
const stage = shadow.querySelector('.stage'), fxl = shadow.querySelector('.fx');
const scareL = shadow.querySelector('.scare'), ui = shadow.querySelector('.ui');
const addCSS = t => { styleEl.textContent += t; };
const addDefs = t => { defsEl.insertAdjacentHTML('beforeend', t); };

// the swatter cursor over anything that can be hit
const SWAT = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
	+ '<path d="M15 15L29 29" stroke="#2a1708" stroke-width="3.4" stroke-linecap="round"/><path d="M15 15L29 29" stroke="#b07a42" stroke-width="1.7" stroke-linecap="round"/>'
	+ '<rect x="3" y="3" width="14" height="14" rx="3.5" transform="rotate(45 10 10)" fill="#ff8a1f" stroke="#1a0b00" stroke-width="1.4"/>'
	+ '<path d="M5.8 10h8.4M10 5.8v8.4M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6" stroke="#1a0b00" stroke-opacity=".5" stroke-width=".9"/></svg>') + '") 10 10, crosshair';

addCSS(`
:host{all:initial;--rim:rgba(205,190,255,.42);--thread:rgba(232,232,255,.6);--ui-bg:rgba(21,16,29,.95);--ui-tx:#efe9f7;--ui-mute:#a69bb8;
	--ui-line:rgba(255,255,255,.09);--ui-chip:rgba(255,255,255,.06);--orange:#ff8a1f;--purple:#a78bfa;
	font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ui-tx)}
:host([data-theme=light]){--rim:rgba(25,15,45,.3);--thread:rgba(45,40,70,.5);--ui-bg:rgba(255,255,255,.97);--ui-tx:#1e1a2a;
	--ui-mute:#6b6479;--ui-line:rgba(25,15,45,.1);--ui-chip:rgba(25,15,45,.05)}
.defs{position:absolute;width:0;height:0}
.stage,.fx,.scare{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.c{position:absolute;left:0;top:0;will-change:transform;pointer-events:none;transform:translate3d(-999px,-999px,0)}
.c svg,.p svg{display:block;overflow:visible}
.hit{pointer-events:all;cursor:${SWAT}}
.dead .hit{pointer-events:none;cursor:default}
.rim{stroke:var(--rim);stroke-width:.6}
.p{position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity}
.word{position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;font:400 30px/1 Creepster,"Chiller",Impact,"Arial Black",fantasy;
	letter-spacing:.03em;color:var(--orange);-webkit-text-stroke:1.6px #1a0b00;paint-order:stroke fill;
	text-shadow:0 3px 0 #1a0b00,0 0 16px rgba(255,120,0,.5)}
.bubble{position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;padding:6px 11px 7px;border-radius:14px;
	background:#fffaf0;color:#1a1208;font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
	box-shadow:0 4px 14px rgba(0,0,0,.35)}
.bubble::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:#fffaf0}
.thread{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:50% 0;background:var(--thread);will-change:transform}
`);
addDefs(`
<radialGradient id="tth-shadow"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="tth-eyeglow"><stop offset="0" stop-color="#ff5a3c" stop-opacity=".9"/><stop offset=".35" stop-color="#ff3b1f" stop-opacity=".45"/><stop offset="1" stop-color="#ff2a00" stop-opacity="0"/></radialGradient>
<radialGradient id="tth-goldglow"><stop offset="0" stop-color="#ffe066" stop-opacity=".95"/><stop offset=".4" stop-color="#ffb000" stop-opacity=".45"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/></radialGradient>
`);

// Each site's own light/dark switch, followed live: TT html[data-theme] (dark by default), TD html.theme-dark (light
// by default), IPT body.Brtness = the White theme (dark by default).
const SITE = CFG.site || 'tt';
function themeNow() {
	if (SITE === 'td') return html.classList.contains('theme-dark') ? 'dark' : 'light';
	if (SITE === 'ipt') return doc.body.classList.contains('Brtness') ? 'light' : 'dark';
	return html.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function syncTheme() { host.setAttribute('data-theme', themeNow()); }
syncTheme();
new MutationObserver(syncTheme).observe(html, { attributes: true, attributeFilter: ['data-theme', 'class'] });
new MutationObserver(syncTheme).observe(doc.body, { attributes: true, attributeFilter: ['class'] });
addEventListener('resize', () => { W = viewW(); H = viewH(); }, { passive: true });

// the Halloween face for the word pops and the pumpkin menu, fetched the first time something needs it
let fontAsked = false;
function wantFont() {
	if (fontAsked) return;
	fontAsked = true;
	const l = doc.createElement('link');
	l.rel = 'stylesheet';
	l.href = 'https://fonts.googleapis.com/css2?family=Creepster&display=swap';
	doc.head.appendChild(l);
}

/* ------------------------------------------------------------------------------------------------ the loop */

// creatures: objects with update(dt) -> keep going?, el, alive; effects: functions (dt) -> keep going?
const live = new Set(), fxs = new Set();
let raf = 0, lastMs = 0, clock = 0, warned = false;
function report(e) { if (!warned && window.console) { warned = true; console.warn('tt-halloween:', e); } }
function frame(ms) {
	const dt = Math.min(.05, Math.max(0, (ms - lastMs) / 1000)) || .016;
	lastMs = ms;
	clock += dt;
	for (const c of live) {
		let more = false;
		try { more = c.update(dt); } catch (e) { report(e); }
		if (!more) { live.delete(c); c.el && c.el.remove(); c.cleanup && c.cleanup(); }
	}
	for (const f of fxs) {
		let more = false;
		try { more = f(dt); } catch (e) { report(e); }
		if (!more) fxs.delete(f);
	}
	scrollV *= Math.max(0, 1 - 6 * dt);
	raf = live.size || fxs.size ? requestAnimationFrame(frame) : 0;
}
function kick() { if (!raf) { lastMs = performance.now(); raf = requestAnimationFrame(frame); } }
function enlist(c) { if (c.el) c.el.__c = c; live.add(c); kick(); return c; }
function fx(f) { fxs.add(f); kick(); }

/* ------------------------------------------------------------------------------------------------ input */

// the mouse (touch screens have no hover, so creatures there only react to taps)
const P = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0, on: false };
let lastInput = performance.now(), scrollV = 0, lastScroll = scrollY;
addEventListener('pointermove', e => {
	if (e.pointerType === 'touch') return;
	const t = performance.now(), dt = Math.max(8, t - P.t) / 1000;
	P.vx = (e.clientX - P.x) / dt; P.vy = (e.clientY - P.y) / dt;
	P.x = e.clientX; P.y = e.clientY; P.t = t; P.on = true;
	stir();
}, { passive: true });
doc.addEventListener('mouseleave', () => { P.on = false; });
addEventListener('blur', () => { P.on = false; });
for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart']) addEventListener(ev, stir, { passive: true, capture: true });
addEventListener('scroll', () => { const y = scrollY; scrollV += y - lastScroll; lastScroll = y; stir(); }, { passive: true });
function pointerNear(x, y, r) { return P.on && hypot(P.x - x, P.y - y) < r; }
// typing: a key pressed in the last 4 s while a text field has the focus (a field that merely kept the focus, like
// the search box after a search, does not count)
let lastKey = -1e9;
addEventListener('keydown', () => { lastKey = performance.now(); }, { passive: true, capture: true });
function typing() {
	const a = doc.activeElement;
	if (!a || performance.now() - lastKey > 4000) return false;
	if (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
	return a.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/i.test(a.type);
}
// after a long quiet spell the creatures gather (see watchers); the first movement scatters them
let quietCrowd = false;
function stir() {
	lastInput = performance.now();
	if (quietCrowd) { quietCrowd = false; for (const c of live) c.startle && c.startle(); }
}

/* ------------------------------------------------------------------------------------------------ placing things */

function creatureEl(box, cls, inner, parent) {
	const d = doc.createElement('div');
	d.className = 'c ' + cls;
	d.style.width = d.style.height = box + 'px';
	d.style.margin = (-box / 2) + 'px 0 0 ' + (-box / 2) + 'px';
	d.innerHTML = '<svg viewBox="' + (-box / 2) + ' ' + (-box / 2) + ' ' + box + ' ' + box + '" width="' + box + '" height="' + box + '">' + inner + '</svg>';
	(parent || stage).appendChild(d);
	return d;
}
function place(e, x, y, a, s, sx) {
	e.style.transform = 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0) rotate(' + (a || 0).toFixed(3) + 'rad) scale(' + ((s || 1) * (sx || 1)).toFixed(3) + ',' + (s || 1).toFixed(3) + ')';
}
function el(tag, cls, parent) {
	const e = doc.createElement(tag);
	if (cls) e.className = cls;
	(parent || fxl).appendChild(e);
	return e;
}
// a point just past an edge: 0 top, 1 right, 2 bottom, 3 left; out = how far outside
function edgePoint(side, out) {
	const m = 70;
	switch (side) {
		case 0: return { x: rand(m, W - m), y: -out, side };
		case 1: return { x: W + out, y: rand(m, H - m), side };
		case 2: return { x: rand(Math.min(150, W / 3), W - m), y: H + out, side };   // the pumpkin sits bottom left
		default: return { x: -out, y: rand(m, H - m), side };
	}
}
// a point inside the screen, in the band along the given edge (depth = share of the screen)
function bandPoint(side, depth) {
	const d = rand(.05, depth);
	switch (side) {
		case 0: return { x: rand(.08, .92) * W, y: d * H };
		case 1: return { x: (1 - d) * W, y: rand(.1, .9) * H };
		case 2: return { x: rand(.2, .92) * W, y: (1 - d) * H };
		default: return { x: d * W, y: rand(.1, .9) * H };
	}
}
const onScreen = (x, y, m) => x > -m && x < W + m && y > -m && y < H + m;

/* ------------------------------------------------------------------------------------------------ effects */

function particle(node, x, y, o) {
	let t = 0, r = o.r || 0;
	const life = o.life || 1, fade = o.fade == null ? .6 : o.fade, s0 = o.s || 1, s1 = o.s1 == null ? s0 : o.s1;
	fx(dt => {
		t += dt;
		if (o.drag) { const k = Math.max(0, 1 - o.drag * dt); o.vx *= k; o.vy *= k; }
		o.vy += (o.g || 0) * dt;
		x += o.vx * dt; y += o.vy * dt; r += (o.vr || 0) * dt;
		const k = t / life;
		node.style.opacity = k > fade ? Math.max(0, 1 - (k - fade) / (1 - fade)) * (o.o || 1) : (o.o || 1);
		node.style.transform = 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0) rotate(' + n1(r) + 'deg) scale(' + lerp(s0, s1, k).toFixed(3) + ')';
		if (t >= life) { node.remove(); return false; }
		return true;
	});
}
function dot(size, bg, parent) {
	const d = el('div', 'p', parent);
	d.style.cssText += 'width:' + size + 'px;height:' + size + 'px;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;border-radius:50%;background:' + bg;
	return d;
}
function svgBit(markup, w, h, parent) {
	const d = el('div', 'p', parent);
	d.style.width = w + 'px'; d.style.height = h + 'px'; d.style.margin = (-h / 2) + 'px 0 0 ' + (-w / 2) + 'px';
	d.innerHTML = '<svg viewBox="' + (-w / 2) + ' ' + (-h / 2) + ' ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + markup + '</svg>';
	return d;
}

// the comic word that pops out of a hit
function word(text, x, y, color, size) {
	wantFont();
	const w = el('div', 'word');
	w.textContent = text;
	if (color) w.style.color = color;
	if (size) w.style.fontSize = size + 'px';
	w.style.left = n1(x) + 'px'; w.style.top = n1(y) + 'px';
	const r = rand(-13, 13);
	w.animate([
		{ transform: 'translate(-50%,-50%) rotate(' + r + 'deg) scale(.25)', opacity: 0 },
		{ transform: 'translate(-50%,-62%) rotate(' + r + 'deg) scale(1.22)', opacity: 1, offset: .16 },
		{ transform: 'translate(-50%,-64%) rotate(' + r + 'deg) scale(1)', opacity: 1, offset: .3 },
		{ transform: 'translate(-50%,-150%) rotate(' + (r * .5) + 'deg) scale(.96)', opacity: 0 },
	], { duration: 1350, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).onfinish = () => w.remove();
}
// a speech bubble over a creature for a while
function bubble(text, x, y, ms) {
	const b = el('div', 'bubble');
	b.textContent = text;
	b.style.left = n1(x) + 'px'; b.style.top = n1(y) + 'px';
	b.animate([
		{ transform: 'translate(-50%,-100%) scale(.4)', opacity: 0 },
		{ transform: 'translate(-50%,-112%) scale(1.06)', opacity: 1, offset: .08 },
		{ transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: .14 },
		{ transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: .86 },
		{ transform: 'translate(-50%,-130%) scale(.96)', opacity: 0 },
	], { duration: ms || 2200, easing: 'ease-out', fill: 'forwards' }).onfinish = () => b.remove();
}

// a closed, smooth, irregular blob around (0, 0)
function blobPath(r, n, jitter) {
	const pts = [];
	for (let i = 0; i < n; i++) {
		const a = i / n * TAU + rand(-.2, .2), rr = r * (1 + rand(-jitter, jitter));
		pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
	}
	let d = 'M' + n1((pts[0][0] + pts[n - 1][0]) / 2) + ' ' + n1((pts[0][1] + pts[n - 1][1]) / 2);
	for (let i = 0; i < n; i++) {
		const p = pts[i], q = pts[(i + 1) % n];
		d += 'Q' + n1(p[0]) + ' ' + n1(p[1]) + ' ' + n1((p[0] + q[0]) / 2) + ' ' + n1((p[1] + q[1]) / 2);
	}
	return d + 'Z';
}
// goo where something was squashed: [light, mid, dark]
const GOO = {
	green: ['#c6f36b', '#6cbf2c', '#2c6512'],
	purple: ['#d6a8ff', '#8e4fd6', '#3d1670'],
	brown: ['#c99a62', '#7a4f24', '#3a2410'],
	orange: ['#ffd27a', '#ff8a1f', '#a33f06'],
};
// (under: a creature element the goo goes beneath, so a dead body lies in its own mess)
function splat(x, y, r, colors, under, stay) {
	const g = colors || GOO.green, id = uid('goo'), box = Math.ceil(r * 5);
	let drops = '';
	for (let i = 0, n = irand(5, 9); i < n; i++) {
		const a = rand(0, TAU), d = r * rand(1.25, 2.1), rr = r * rand(.07, .19);
		drops += '<circle cx="' + n1(Math.cos(a) * d) + '" cy="' + n1(Math.sin(a) * d) + '" r="' + n1(rr) + '"/>';
	}
	const s = svgBit('<defs><radialGradient id="' + id + '" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="' + g[0] + '"/>'
		+ '<stop offset=".55" stop-color="' + g[1] + '"/><stop offset="1" stop-color="' + g[2] + '"/></radialGradient></defs>'
		+ '<g fill="url(#' + id + ')" opacity=".93"><path d="' + blobPath(r, 11, .32) + '"/>' + drops + '</g>'
		+ '<ellipse cx="' + n1(-r * .3) + '" cy="' + n1(-r * .32) + '" rx="' + n1(r * .32) + '" ry="' + n1(r * .16) + '" fill="#fff" opacity=".35" transform="rotate(-25)"/>', box, box);
	s.style.transform = 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0) rotate(' + irand(0, 359) + 'deg)';
	if (under && under.parentNode) under.parentNode.insertBefore(s, under);
	s.firstChild.animate([{ transform: 'scale(.15)' }, { transform: 'scale(1.1)', offset: .55 }, { transform: 'scale(1)' }],
		{ duration: 240, easing: 'cubic-bezier(.2,.9,.3,1.25)' });
	setTimeout(() => { s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }).onfinish = () => s.remove(); }, stay || 2600);
	for (let i = 0, n = irand(4, 7); i < n; i++) {
		const a = rand(0, TAU), v = rand(140, 320);
		particle(dot(n1(rand(3, 6)), g[1]), x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 6, life: rand(.35, .55), fade: .3 });
	}
	return s;
}
// a puff of smoke
function smoke(x, y, n, spread, tint) {
	for (let i = 0; i < n; i++) {
		const size = rand(14, 30) * (spread || 1), a = rand(0, TAU), v = rand(20, 70) * (spread || 1);
		const d = dot(Math.round(size), 'radial-gradient(circle at 40% 40%,' + (tint || 'rgba(205,200,220,.85)') + ',rgba(150,145,165,0) 70%)');
		particle(d, x + rand(-6, 6), y + rand(-6, 6), { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, drag: 1.8, life: rand(.7, 1.2), s: .5, s1: 1.9, fade: .25 });
	}
}
// sparkles (a 4-point star)
const STAR = '<path d="M0-6C.6-1.8 1.8-.6 6 0C1.8.6.6 1.8 0 6C-.6 1.8-1.8.6-6 0C-1.8-.6-.6-1.8 0-6Z"/>';
function sparkle(x, y, color, size, o) {
	const s = svgBit('<g fill="' + color + '">' + STAR + '</g>', 14, 14);
	particle(s, x, y, Object.assign({ vx: rand(-30, 30), vy: rand(-20, 40), vr: rand(-200, 200), life: rand(.5, 1), s: size || 1, s1: .2, fade: .1 }, o || {}));
}

/* ------------------------------------------------------------------------------------------------ sound */

// Everything is synthesised (no files) and only ever starts from a click on a creature, so the browser's autoplay
// rules never apply and nothing makes a noise on its own.
let AC = null, master = null, noiseBuf = null;
function audio() {
	if (!SOUND) return null;
	if (!AC) {
		const C = window.AudioContext || window.webkitAudioContext;
		if (!C) return null;
		try {
			AC = new C();
			master = AC.createGain();
			master.gain.value = .55;
			const comp = AC.createDynamicsCompressor();
			master.connect(comp); comp.connect(AC.destination);
			noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
			const d = noiseBuf.getChannelData(0);
			for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
		} catch (e) { AC = null; return null; }
	}
	if (AC.state === 'suspended') AC.resume();
	return AC;
}
function env(g, t, a, peak, d) {
	g.gain.setValueAtTime(.0001, t);
	g.gain.exponentialRampToValueAtTime(peak, t + a);
	g.gain.exponentialRampToValueAtTime(.0001, t + a + d);
}
function tone(type, f0, f1, t, a, peak, d, to) {
	const o = AC.createOscillator(), g = AC.createGain();
	o.type = type;
	o.frequency.setValueAtTime(f0, t);
	if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
	env(g, t, a, peak, d);
	o.connect(g); g.connect(to || master);
	o.start(t); o.stop(t + a + d + .05);
	return o;
}
function noise(t, a, peak, d, ftype, freq, q, to) {
	const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
	s.buffer = noiseBuf;
	f.type = ftype; f.frequency.value = freq; f.Q.value = q || 1;
	env(g, t, a, peak, d);
	s.connect(f); f.connect(g); g.connect(to || master);
	s.start(t, rand(0, .5)); s.stop(t + a + d + .05);
	return f;
}
const SFX = {
	splat(t) { noise(t, .004, .55, .2, 'lowpass', 900, 1.2); tone('sine', 190, 55, t, .002, .45, .14); },
	pop(t) { tone('sine', 820, 260, t, .002, .35, .09); noise(t, .002, .2, .05, 'highpass', 2500); },
	squeak(t) { tone('triangle', 2300, 3400, t, .01, .12, .08); tone('triangle', 3300, 2100, t + .09, .01, .1, .1); },
	bonk(t) { tone('triangle', 560, 170, t, .003, .35, .2); },
	snip(t) { noise(t, .001, .3, .03, 'highpass', 4000); tone('sine', 1500, 900, t + .02, .002, .15, .06); },
	crunch(t) { for (let i = 0; i < 5; i++) noise(t + i * rand(.015, .03), .001, rand(.2, .4), .04, 'bandpass', rand(1800, 4200), 2); },
	clatter(t) { for (let i = 0; i < 7; i++) { const s = t + i * rand(.04, .09); tone('square', rand(900, 1600), rand(500, 800), s, .001, .06, .05); noise(s, .001, .12, .03, 'bandpass', 3000, 3); } },
	hiss(t) { noise(t, .04, .32, .7, 'highpass', 3000, .7); noise(t, .02, .12, .5, 'bandpass', 6500, 1); },
	thud(t) { tone('sine', 110, 38, t, .004, .8, .32); noise(t, .002, .45, .12, 'lowpass', 500); },
	smash(t) { noise(t, .002, .6, .25, 'lowpass', 1400); tone('sine', 140, 50, t, .003, .5, .2); this.crunch(t + .03); },
	poof(t) { noise(t, .02, .3, .35, 'bandpass', 900, .6); },
	ouch(t) { tone('sawtooth', 420, 250, t, .02, .12, .25); },
	giggle(t) { for (let i = 0; i < 5; i++) tone('sine', 1100 - i * 60, 1400 - i * 60, t + i * .075, .005, .12, .05); },
	wail(t) {
		const o = AC.createOscillator(), g = AC.createGain(), l = AC.createOscillator(), lg = AC.createGain();
		o.type = 'sine'; o.frequency.setValueAtTime(640, t); o.frequency.exponentialRampToValueAtTime(330, t + 1.3);
		l.frequency.value = 6; lg.gain.value = 18; l.connect(lg); lg.connect(o.frequency);
		env(g, t, .15, .2, 1.2); o.connect(g); g.connect(master);
		o.start(t); l.start(t); o.stop(t + 1.45); l.stop(t + 1.45);
	},
	cackle(t) {
		for (let i = 0; i < 7; i++) {
			const s = t + i * .11, f = AC.createBiquadFilter(), g = AC.createGain(), o = AC.createOscillator();
			o.type = 'sawtooth'; o.frequency.setValueAtTime(430 - i * 18, s); o.frequency.exponentialRampToValueAtTime(330 - i * 18, s + .08);
			f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3;
			env(g, s, .01, .2, .08); o.connect(f); f.connect(g); g.connect(master); o.start(s); o.stop(s + .12);
		}
	},
	// the jump scare: a distorted shriek over a burst of noise and a low hit
	scream(t) {
		const shaper = AC.createWaveShaper(), curve = new Float32Array(1024), g = AC.createGain(), f = AC.createBiquadFilter();
		for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
		shaper.curve = curve; f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = .7;
		env(g, t, .02, .26, .95); shaper.connect(f); f.connect(g); g.connect(master);
		for (const det of [0, 23, -17]) {
			const o = AC.createOscillator();
			o.type = 'sawtooth';
			o.frequency.setValueAtTime(700 + det, t); o.frequency.exponentialRampToValueAtTime(1500 + det, t + .12);
			o.frequency.exponentialRampToValueAtTime(520 + det, t + .95);
			o.connect(shaper); o.start(t); o.stop(t + 1);
		}
		noise(t, .005, .35, .55, 'highpass', 1800, .5);
		tone('sine', 75, 38, t, .005, .7, .35);
	},
	crack(t) { noise(t, .001, .5, .06, 'highpass', 3200); for (let i = 0; i < 4; i++) tone('sine', rand(4000, 7500), rand(3000, 5000), t + .02 + i * .03, .001, .05, .25); },
};
function sfx(name) {
	const ac = audio();
	if (!ac || !SFX[name]) return;
	try { SFX[name](ac.currentTime + .005); } catch (e) { report(e); }
}

/* ------------------------------------------------------------------------------------------------ spiders */

// Three species with their own temper: the house spider bolts from the mouse, the black widow walks up to it and
// waves its front legs, the tarantula stands its ground and rears up. (legD/legL: leg colour on the dark/light theme)
const SPIDERS = {
	house: { scale: [.8, 1], speed: [150, 250], turn: 7, mood: 'skittish', fear: 130, legD: '#6e5540', legL: '#3a2a1c', knee: '#9a7a58', run: [.35, 1.3], pause: [.25, 1.3], wander: .55 },
	widow: { scale: [.95, 1.12], speed: [70, 115], turn: 4, mood: 'bold', fear: 190, legD: '#45454f', legL: '#121216', knee: '#6a6a78', run: [.8, 2], pause: [.6, 1.6], wander: .3 },
	tarantula: { scale: [1.35, 1.6], speed: [50, 80], turn: 2.6, mood: 'threat', fear: 170, legD: '#5e4330', legL: '#2c1c11', knee: '#c98f58', run: [1, 2.4], pause: [.8, 1.8], wander: .25, thick: 1.6 },
};
addDefs(`
<radialGradient id="tth-house-a" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#a07b55"/><stop offset=".5" stop-color="#523826"/><stop offset="1" stop-color="#1c110a"/></radialGradient>
<radialGradient id="tth-house-t" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#8e6a48"/><stop offset=".6" stop-color="#45311f"/><stop offset="1" stop-color="#170e08"/></radialGradient>
<radialGradient id="tth-widow-a" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#666675"/><stop offset=".45" stop-color="#18181e"/><stop offset="1" stop-color="#020203"/></radialGradient>
<radialGradient id="tth-widow-t" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#55555f"/><stop offset=".55" stop-color="#131317"/><stop offset="1" stop-color="#020203"/></radialGradient>
<radialGradient id="tth-tarantula-a" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#83603c"/><stop offset=".5" stop-color="#382416"/><stop offset="1" stop-color="#0f0905"/></radialGradient>
<radialGradient id="tth-tarantula-t" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#735234"/><stop offset=".55" stop-color="#301f13"/><stop offset="1" stop-color="#0d0805"/></radialGradient>
<radialGradient id="tth-sac" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e9e5dc"/><stop offset="1" stop-color="#b3ab9e"/></radialGradient>
`);
addCSS(`
.sp{--leg:var(--leg-d)}
:host([data-theme=light]) .sp{--leg:var(--leg-l)}
.sp .legs path,.sp .legs line,.sp .palp{fill:none;stroke:var(--leg);stroke-linecap:round;stroke-linejoin:round}
`);

// local units: the spider faces +x, its body centre at 0,0; hips along the sides of the cephalothorax
const HIPS = [[9.6, 4.1], [7.4, 5.3], [4.7, 5.6], [2.3, 4.9]];
const LEN1 = [13.5, 12, 11.5, 14.5], LEN2 = [17.5, 13.5, 13.5, 19];
const REST = [34, 64, 116, 152].map(d => d / DEG);   // where each pair of feet rests, measured from straight ahead
const STRIDE = 5.5, STRIDES = [1.1, .75, .75, 1.1];  // how far a foot travels either side of its resting place (x pair)

function spiderSVG(v) {
	const th = SPIDERS[v].thick || 1;
	let legs = '';
	for (let i = 0; i < 8; i++) legs += '<path class="lf" stroke-width="' + n1(2.5 * th) + '"/><path class="lt" stroke-width="' + n1(1.6 * th) + '"/><circle class="kn" r="' + n1(1.25 * th) + '" fill="' + SPIDERS[v].knee + '"/>';
	const marks = {
		house: '<path d="M-21 0h5M-18.6-2.5l2.9 2.5-2.9 2.5M-14.4-3.3l3 3.3-3 3.3M-10-3.4l2.9 3.4L-10 3.4" fill="none" stroke="#f0d2a8" stroke-opacity=".34" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>',
		widow: '<path d="M-16.6-3.4h5.6L-13.8 0l2.8 3.4h-5.6l2.8-3.4z" fill="#e0142e"/><path d="M-16.6-3.4h5.6L-13.8 0z" fill="#ff6070" opacity=".45"/>',
		tarantula: '<ellipse cx="-11" rx="12.8" ry="9.8" fill="none" stroke="#c98f58" stroke-opacity=".55" stroke-width="2.2" stroke-dasharray=".5 1.4"/>'
			+ '<path d="M5.2-5.4v10.8M-.2 0h10.8M1.6-3.8l7.2 7.6M1.6 3.8l7.2-7.6" stroke="#c98f58" stroke-opacity=".3" stroke-width=".8"/>',
	};
	return '<ellipse cx="-4" rx="30" ry="24" fill="url(#tth-shadow)" opacity=".5"/>'
		+ '<g class="legs">' + legs + '</g>'
		+ '<g class="bod">'
		+ '<ellipse class="rim" cx="-11" rx="12" ry="9" fill="url(#tth-' + v + '-a)"/>' + marks[v]
		+ '<ellipse cx="-14.6" cy="-3.4" rx="4.4" ry="2" fill="#fff" opacity=".17"/>'
		+ '<ellipse cx="-.6" rx="2.4" ry="2" fill="url(#tth-' + v + '-t)"/>'
		+ '<ellipse class="rim" cx="5.2" rx="7.6" ry="6.4" fill="url(#tth-' + v + '-t)"/>'
		+ '<ellipse cx="3.3" cy="-2.5" rx="2.8" ry="1.3" fill="#fff" opacity=".15"/>'
		+ '<path class="palp" d="M11.8-2.9l3.2-1.8 2.2 1.1M11.8 2.9l3.2 1.8 2.2-1.1" stroke-width="' + n1(1.1 * th) + '"/>'
		+ '<path d="M12-1.7q3.2.2 3.6 1.6M12 1.7q3.2-.2 3.6-1.6" fill="none" stroke="#050305" stroke-width="2" stroke-linecap="round"/>'
		+ '<g fill="#050306"><circle cx="11" cy="-1.3" r="1.25"/><circle cx="11" cy="1.3" r="1.25"/><circle cx="9.5" cy="-2.9" r=".75"/>'
		+ '<circle cx="9.5" cy="2.9" r=".75"/><circle cx="8.3" cy="-1.5" r=".6"/><circle cx="8.3" cy="1.5" r=".6"/></g>'
		+ '<g fill="#fff" opacity=".9"><circle cx="11.35" cy="-1.65" r=".4"/><circle cx="11.35" cy=".95" r=".4"/></g>'
		+ '</g>'
		+ '<circle class="hit" cx="-2" r="21" fill="transparent"/>';
}

class Spider {
	constructor(v, o) {
		o = o || {};
		const V = this.V = SPIDERS[v];
		this.kind = 'spider'; this.variant = v; this.alive = true; this.scareable = true; this.t = 0;
		this.s = (o.scale || rand(V.scale[0], V.scale[1])) * fit(.85);
		this.el = creatureEl(100, 'sp', spiderSVG(v));
		this.el.style.setProperty('--leg-d', V.legD);
		this.el.style.setProperty('--leg-l', V.legL);
		this.bod = this.el.querySelector('.bod');
		const paths = this.el.querySelectorAll('.legs path'), knees = this.el.querySelectorAll('.legs .kn');
		this.legs = [];
		for (let i = 0; i < 8; i++) {
			const side = i < 4 ? -1 : 1, k = i % 4, reach = (LEN1[k] + LEN2[k]) * .74, hip = { x: HIPS[k][0], y: side * HIPS[k][1] };
			this.legs.push({
				side, k, hip, l1: LEN1[k], l2: LEN2[k], ph: rand(0, TAU), po: rand(-.25, .25),
				rest: { x: hip.x + Math.cos(REST[k]) * reach, y: hip.y + side * Math.sin(REST[k]) * reach },
				grp: (k + (side > 0 ? 1 : 0)) % 2, pf: paths[i * 2], pt: paths[i * 2 + 1], kn: knees[i],
			});
		}
		this.x = this.y = this.a = 0; this.speed = 0; this.raise = 0; this.ph = rand(0, TAU); this.prevA = 0;
	}
	toW(lx, ly) { const c = Math.cos(this.a), s = Math.sin(this.a), k = this.s; return [this.x + (lx * c - ly * s) * k, this.y + (lx * s + ly * c) * k]; }
	toL(wx, wy) { const c = Math.cos(this.a), s = Math.sin(this.a), dx = (wx - this.x) / this.s, dy = (wy - this.y) / this.s; return [dx * c + dy * s, -dx * s + dy * c]; }
	plant() { this.ph = rand(0, TAU); this.prevA = this.a; }
	// A walking cycle in the spider's own frame: in the stance half a foot moves back exactly as fast as the body
	// moves forward, so it stays put on the screen; in the swing half it lifts and swings forward again. The legs
	// go in two alternating groups of four (the gait real spiders use); turning on the spot also takes steps.
	gait(dt) {
		const turn = Math.abs(angDiff(this.prevA, this.a)) / Math.max(dt, .001);
		this.prevA = this.a;
		const v = this.speed / this.s + turn * 12;
		this.ph = (this.ph + Math.min(32, v * Math.PI / (2 * STRIDE)) * dt) % TAU;
		for (const L of this.legs) {
			const p = (this.ph + L.grp * Math.PI + L.po) % TAU, stance = p < Math.PI, u = stance ? p / Math.PI : p / Math.PI - 1, A = STRIDE * STRIDES[L.k];
			let lx = L.rest.x + (stance ? lerp(A, -A, u) : lerp(-A, A, ease.inOut(u))), ly = L.rest.y;
			if (!stance) { const k = Math.sin(Math.PI * u) * .16; lx += (L.hip.x - lx) * k; ly += (L.hip.y - ly) * k; }   // a lifted foot
			if (this.raise > .01 && L.k <= 1) {   // front legs up: threat display or a curious wave
				const r = this.raise, wave = Math.sin(this.t * 9 + L.ph) * 2.6;
				lx = lerp(lx, L.hip.x + 15 - L.k * 5 + wave, r);
				ly = lerp(ly, L.hip.y + L.side * (10 + L.k * 3), r);
			}
			this.ik(L, lx, ly);
		}
	}
	// two-bone leg from hip to foot, the knee bent outward
	ik(L, fx, fy) {
		const hx = L.hip.x, hy = L.hip.y;
		let dx = fx - hx, dy = fy - hy, d = hypot(dx, dy) || .01;
		const max = L.l1 + L.l2 - .05, min = Math.abs(L.l1 - L.l2) + .5;
		if (d > max || d < min) { const c = clamp(d, min, max); fx = hx + dx / d * c; fy = hy + dy / d * c; dx = fx - hx; dy = fy - hy; d = c; }
		const base = Math.atan2(dy, dx), al = Math.acos(clamp((L.l1 * L.l1 + d * d - L.l2 * L.l2) / (2 * L.l1 * d), -1, 1));
		const k1x = hx + L.l1 * Math.cos(base + al), k1y = hy + L.l1 * Math.sin(base + al);
		const k2x = hx + L.l1 * Math.cos(base - al), k2y = hy + L.l1 * Math.sin(base - al);
		// The knee of a real spider bends upwards, towards the viewer, so from above a leg runs almost straight from
		// hip to foot: take the knee on the outer side and keep only 15 % of its sideways offset. (More, and the
		// knees of the two middle legs swing into each other.)
		const out = L.side * k1y > L.side * k2y, rkx = out ? k1x : k2x, rky = out ? k1y : k2y;
		const cu = ((rkx - hx) * dx + (rky - hy) * dy) / (d * d), cx = hx + dx * cu, cy = hy + dy * cu;
		const kx = cx + (rkx - cx) * .15, ky = cy + (rky - cy) * .15;
		// the lower leg bows a little outward, like the real thing
		const lx = fx - kx, ly = fy - ky, ll = hypot(lx, ly) || 1;
		let px = -ly / ll, py = lx / ll;
		if (py * L.side < 0) { px = -px; py = -py; }
		L.pf.setAttribute('d', 'M' + hx + ' ' + hy + 'L' + n1(kx) + ' ' + n1(ky));
		L.pt.setAttribute('d', 'M' + n1(kx) + ' ' + n1(ky) + 'Q' + n1((kx + fx) / 2 + px * 1.9) + ' ' + n1((ky + fy) / 2 + py * 1.9) + ' ' + n1(fx) + ' ' + n1(fy));
		L.kn.setAttribute('cx', n1(kx));
		L.kn.setAttribute('cy', n1(ky));
	}
	draw() { place(this.el, this.x, this.y, this.a, this.s); }
	// squashed (legs splay, body flattens into the goo) or curled up and spinning away; one leg twitches a while
	die(x, y, how) {
		this.alive = false; this.dt = 0;
		this.el.classList.add('dead');
		this.how = how || (chance(.65) ? 'squash' : 'curl');
		noteKill(this);
		if (this.how === 'squash') {
			splat(this.x, this.y, 9 + 9 * this.s, this.variant === 'widow' ? GOO.purple : GOO.green, this.el);
			word(pick(['SPLAT!', 'SQUISH!', 'CRUNCH!', 'GOTCHA!', 'EWW!']), x, y - 16);
			sfx('splat');
		} else {
			this.spin = rand(5, 9) * (chance(.5) ? 1 : -1);
			word(pick(['GOTCHA!', 'BYE!', 'EEK!']), x, y - 16);
			sfx('pop');
		}
		kick();
	}
	dying(dt) {
		const t = this.dt += dt, k = ease.out(Math.min(1, t / .3));
		for (const L of this.legs) {
			let fx, fy;
			if (this.how === 'squash') { fx = L.hip.x + (L.rest.x - L.hip.x) * lerp(1, 1.12, k); fy = L.hip.y + (L.rest.y - L.hip.y) * lerp(1, 1.2, k); }
			else { fx = lerp(L.rest.x, L.hip.x + (L.rest.x - L.hip.x) * .3 - 1.5, k); fy = lerp(L.rest.y, L.hip.y + (L.rest.y - L.hip.y) * .22, k); }
			if (L.k === 1 && L.side > 0 && t > .3 && t < 1.7) fy += Math.sin(t * 38) * 1.6 * (1.7 - t);
			this.ik(L, fx, fy);
		}
		if (this.how === 'squash') this.bod.setAttribute('transform', 'scale(' + lerp(1, 1.14, k).toFixed(3) + ',' + lerp(1, 1.22, k).toFixed(3) + ')');
		else { this.a += this.spin * dt; this.spin *= Math.max(0, 1 - 2.2 * dt); this.s *= Math.max(.2, 1 - .55 * dt); }
		this.draw();
		if (t > 1.9) this.el.style.opacity = Math.max(0, 1 - (t - 1.9) / .7);
		return t < 2.6;
	}
	hit(x, y) { this.die(x, y); }
}

// a route for a crawler: in from one edge, past a point or two (often close to an edge, out of the way), out again
function crawlRoute(creep) {
	const s = irand(0, 3), start = edgePoint(s, 45);
	if (creep) return { start, points: [bandPoint(s, .3), edgePoint(s, 80)] };
	const e = chance(.25) ? s : (s + irand(1, 3)) % 4, pts = [];
	for (let i = irand(1, 2); i > 0; i--) pts.push(chance(.6) ? bandPoint(chance(.5) ? s : e, .2) : { x: rand(.15, .85) * W, y: rand(.15, .85) * H });
	pts.push(edgePoint(e, 80));
	return { start, points: pts };
}

class Crawler extends Spider {
	constructor(v, o) {
		o = o || {};
		super(v || pick(['house', 'house', 'house', 'widow', 'widow', 'tarantula']), o);
		const r = crawlRoute(o.creep);
		this.wps = r.points; this.wi = 0; this.x = r.start.x; this.y = r.start.y;
		this.a = this.aim = Math.atan2(this.wps[0].y - this.y, this.wps[0].x - this.x);
		this.plant();
		this.creep = !!o.creep; this.cool = 0; this.p1 = rand(0, TAU); this.p2 = rand(0, TAU);
		this.mode = 'run'; this.modeT = rand(...this.V.run); this.want = 0;
		this.target = rand(...this.V.speed) * (this.creep ? .3 : 1);
		this.draw();
		enlist(this);
	}
	update(dt) {
		this.t += dt;
		if (!this.alive) return this.dying(dt);
		this.think(dt);
		const off = Math.abs(angDiff(this.a, this.aim)), turn = this.V.turn * (this.mode === 'flee' ? 2.2 : 1);
		this.a += clamp(angDiff(this.a, this.aim), -turn * dt, turn * dt);
		this.speed += clamp(this.want * (off > 1.1 ? .15 : 1) - this.speed, -1400 * dt, 1000 * dt);
		this.x += Math.cos(this.a) * this.speed * dt;
		this.y += Math.sin(this.a) * this.speed * dt;
		const up = this.mode === 'threat' ? 1 : this.mode === 'stalk' && this.close ? .55 : 0;
		this.raise += (up - this.raise) * Math.min(1, dt * 6);
		this.gait(dt);
		this.draw();
		if (onScreen(this.x, this.y, -10)) this.entered = true;
		return !((this.entered || this.t > 6) && this.leaving && !onScreen(this.x, this.y, 70)) && this.t < 75;
	}
	think(dt) {
		const V = this.V, wp = this.wps[this.wi];
		const dx = wp.x - this.x, dy = wp.y - this.y;
		if (hypot(dx, dy) < 26 && this.wi < this.wps.length - 1) this.wi++;
		this.leaving = this.wi === this.wps.length - 1;
		this.close = false;
		this.cool -= dt;
		if (this.mode !== 'flee' && this.mode !== 'threat' && this.mode !== 'stalk' && this.cool <= 0 && !this.creep && pointerNear(this.x, this.y, V.fear)) this.react();
		this.modeT -= dt;
		const wander = V.wander * (Math.sin(this.t * 1.9 + this.p1) * .7 + Math.sin(this.t * 3.7 + this.p2) * .3);
		switch (this.mode) {
			case 'run':
				this.want = this.target;
				this.aim = Math.atan2(dy, dx) + wander;
				if (this.creep && this.leaving && !this.startled) { this.want = 0; if (this.t > 45) this.startled = true; }   // waits, watching
				else if (this.modeT <= 0) { this.mode = 'pause'; this.modeT = rand(...V.pause); this.aim += rand(-.6, .6); }
				break;
			case 'pause':
				this.want = 0;
				if (this.modeT <= 0) { this.mode = 'run'; this.modeT = rand(...V.run); this.target = rand(...V.speed) * (this.creep && !this.startled ? .3 : 1); }
				break;
			case 'flee':
				this.want = V.speed[1] * 1.5;
				if (this.modeT <= 0) { this.mode = 'run'; this.modeT = rand(...V.run); }
				break;
			case 'stalk': {   // the widow walks up to the mouse and stops in front of it, waving its front legs
				const pd = hypot(P.x - this.x, P.y - this.y);
				this.aim = Math.atan2(P.y - this.y, P.x - this.x);
				this.close = pd < 95;
				this.want = this.close ? 0 : 60;
				if (this.modeT <= 0 || !P.on) { this.mode = 'run'; this.modeT = rand(...V.run); this.cool = 3; }
				break;
			}
			case 'threat':   // the tarantula rears up, turned towards the mouse, then leaves
				this.want = 0;
				if (P.on) this.aim = Math.atan2(P.y - this.y, P.x - this.x);
				if (this.modeT <= 0) { this.mode = 'run'; this.modeT = 9; this.wi = this.wps.length - 1; this.cool = 4; }
				break;
		}
	}
	react() {
		const V = this.V, pd = hypot(this.x - P.x, this.y - P.y);
		if (V.mood === 'skittish' || pd < 55) { this.mode = 'flee'; this.modeT = rand(.5, .9); this.aim = Math.atan2(this.y - P.y, this.x - P.x) + rand(-.6, .6); }
		else if (V.mood === 'bold') { this.mode = 'stalk'; this.modeT = rand(2.2, 3.5); }
		else { this.mode = 'threat'; this.modeT = rand(1.4, 2); }
	}
	// the mouse moved after a long quiet spell: bolt for the nearest edge
	startle() {
		if (!this.alive) return;
		const side = [this.y, W - this.x, H - this.y, this.x].reduce((b, d, i, a) => d < a[b] ? i : b, 0);
		const e = edgePoint(side, 90);
		this.wps = [{ x: side % 2 ? e.x : this.x, y: side % 2 ? this.y : e.y }]; this.wi = 0;
		this.startled = true; this.creep = false; this.mode = 'flee'; this.modeT = 8;
		this.aim = Math.atan2(this.wps[0].y - this.y, this.wps[0].x - this.x);
	}
}

// Drops from the top of the screen on a silk thread, bobs and swings (scrolling the page sets it swinging), climbs
// back up. A shy one shoots back up when the mouse comes close, a bold one lowers itself towards it.
class Dangler extends Spider {
	constructor(v) {
		super(v || (chance(.7) ? 'house' : 'widow'));
		this.ax = rand(.06, .94) * W; this.L = 0; this.vL = 0; this.Lt = rand(.18, .46) * H;
		this.phi = rand(-.05, .05); this.vphi = 0; this.phase = 'drop'; this.hangT = rand(3.5, 8); this.bold = chance(.4);
		this.thread = el('div', 'thread', stage);
		stage.insertBefore(this.thread, this.el);
		this.pos(); this.pose(0); this.draw(); this.drawThread();
		enlist(this);
	}
	// the thread ends at the tip of the abdomen; the spider hangs head down along it
	pos() {
		const ux = Math.sin(this.phi), uy = Math.cos(this.phi), tip = 22 * this.s;
		this.x = this.ax + ux * (this.L + tip);
		this.y = -60 + uy * (this.L + tip);
		this.a = Math.atan2(uy, ux);
	}
	drawThread() { this.thread.style.transform = 'translate3d(' + n1(this.ax) + 'px,-60px,0) rotate(' + (-this.phi).toFixed(3) + 'rad) scaleY(' + n1(Math.max(0, this.L)) + ')'; }
	pose(dt) {
		const climb = this.phase === 'climb';
		for (const L of this.legs) {
			const w = climb ? Math.sin(this.t * 16 + L.grp * Math.PI) * 4 : Math.sin(this.t * (1.5 + L.k * .4) + L.ph) * 1.4;
			let fx = L.rest.x * .92 + (climb ? w : 0), fy = L.rest.y * .92 + (climb ? 0 : w);
			if (this.raise > .01 && L.k <= 1) { fx += 7 * this.raise; fy += L.side * 5 * this.raise; }
			this.ik(L, fx, fy);
		}
	}
	update(dt) {
		this.t += dt;
		if (this.phase === 'fall') return this.falling(dt);
		if (!this.alive) { this.L = Math.max(0, this.L - 900 * dt); this.drawThread(); return this.dying(dt); }
		if (this.phase === 'hang' && pointerNear(this.x, this.y, 120)) {
			if (!this.bold) { this.phase = 'climb'; this.climbV = 320; }
			else if (!this.leaned) { this.leaned = true; this.Lt = Math.min(H * .8, this.Lt + 60); this.hangT = 1.6; this.raise = 1; }
		}
		if (this.phase === 'drop') {
			this.L += Math.max(120, 600 * (1 - this.L / this.Lt) + 120) * dt;
			if (this.L >= this.Lt) { this.phase = 'hang'; this.vL = 180; }
		} else if (this.phase === 'hang') {
			this.vL += (-30 * (this.L - this.Lt) - 4.2 * this.vL) * dt;   // a little bounce on the silk
			this.L += this.vL * dt;
			if ((this.hangT -= dt) <= 0) { this.phase = 'climb'; this.climbV = rand(90, 140); }
		} else if ((this.L -= this.climbV * dt) <= -20) return false;
		// the swing: a pendulum the page scroll pushes
		this.vphi += (-(1600 / Math.max(60, this.L)) * Math.sin(this.phi) - .8 * this.vphi + rand(-.4, .4)) * dt + clamp(scrollV, -80, 80) * .00045;
		this.phi = clamp(this.phi + this.vphi * dt, -1.1, 1.1);
		this.raise = Math.max(0, this.raise - dt * .5);
		this.pos(); this.pose(dt); this.draw(); this.drawThread();
		return true;
	}
	hit(x, y) {
		if (chance(.45)) { this.die(x, y, 'squash'); return; }
		// the thread snaps and the spider drops out of the picture, legs curling
		this.alive = false; this.phase = 'fall'; this.dt = 0;
		this.el.classList.add('dead');
		this.vx = this.vphi * Math.max(60, this.L) * .5; this.vy = 0; this.spin = rand(-7, 7); this.how = 'curl';
		noteKill(this);
		word(pick(['SNIP!', 'SNAP!', 'BYE-BYE!']), x, y - 16);
		sfx('snip');
	}
	falling(dt) {
		this.dt += dt;
		this.vy += 1500 * dt;
		this.x += this.vx * dt; this.y += this.vy * dt; this.a += this.spin * dt;
		this.L = Math.max(0, this.L - 1100 * dt);   // the loose end springs back up
		const k = ease.out(Math.min(1, this.dt / .3));
		for (const L of this.legs) this.ik(L, lerp(L.rest.x, L.hip.x + (L.rest.x - L.hip.x) * .3 - 1.5, k), lerp(L.rest.y, L.hip.y + (L.rest.y - L.hip.y) * .22, k));
		this.draw(); this.drawThread();
		return this.y < H + 90;
	}
	cleanup() { this.thread.remove(); }
}

// A silk egg sac in a corner wobbles, splits, and a brood of spiderlings pours out in every direction.
class Mini {
	constructor(x, y, a, brood) {
		this.kind = 'spiderling'; this.alive = true; this.scareable = false; this.brood = brood; this.t = 0;
		let legs = '';
		for (let i = 0; i < 8; i++) legs += '<line/>';
		this.el = creatureEl(44, 'sp', '<g class="legs" stroke-width="1.5">' + legs + '</g>'
			+ '<ellipse class="rim" cx="-5" rx="6.4" ry="5" fill="url(#tth-house-a)"/><ellipse class="rim" cx="3" rx="4.5" ry="3.9" fill="url(#tth-house-t)"/>'
			+ '<circle cx="6.1" cy="-1.1" r=".9" fill="#000"/><circle cx="6.1" cy="1.1" r=".9" fill="#000"/><circle class="hit" r="14" fill="transparent"/>');
		this.el.style.setProperty('--leg-d', SPIDERS.house.legD);
		this.el.style.setProperty('--leg-l', SPIDERS.house.legL);
		this.lines = this.el.querySelectorAll('line');
		this.x = x; this.y = y; this.a = a; this.s = rand(.7, .95) * fit(1); this.v = rand(150, 260); this.da = 0; this.turnT = 0; this.ph = rand(0, TAU);
		this.draw();
		enlist(this);
	}
	draw() { place(this.el, this.x, this.y, this.a, this.s); }
	update(dt) {
		this.t += dt;
		if (!this.alive) { this.el.style.opacity = Math.max(0, 1 - this.t / 1.6); return this.t < 1.6; }
		if ((this.turnT -= dt) <= 0) { this.turnT = rand(.15, .45); this.da = rand(-1.3, 1.3); this.v = chance(.12) ? 0 : rand(120, 280); }
		if (pointerNear(this.x, this.y, 90)) { this.a = Math.atan2(this.y - P.y, this.x - P.x); this.v = 320; this.da = 0; }
		this.a += this.da * dt;
		this.x += Math.cos(this.a) * this.v * dt;
		this.y += Math.sin(this.a) * this.v * dt;
		this.ph += (this.v + 30) * dt * .22;
		for (let i = 0; i < 8; i++) {
			const side = i < 4 ? -1 : 1, k = i % 4, hx = HIPS[k][0] * .5 + 1, hy = side * HIPS[k][1] * .5;
			const ang = REST[k] + .38 * Math.sin(this.ph + ((k + (side > 0 ? 1 : 0)) % 2) * Math.PI), len = 11 + (k === 0 || k === 3 ? 2 : 0);
			const ln = this.lines[i];
			ln.setAttribute('x1', n1(hx)); ln.setAttribute('y1', n1(hy));
			ln.setAttribute('x2', n1(hx + Math.cos(ang) * len)); ln.setAttribute('y2', n1(hy + side * Math.sin(ang) * len));
		}
		this.draw();
		return (this.t < 1.5 || onScreen(this.x, this.y, 30)) && this.t < 16;
	}
	hit(x, y) {
		this.alive = false; this.t = 0;
		this.el.classList.add('dead');
		noteKill(this);
		splat(this.x, this.y, 6, GOO.green, this.el, 1200);
		if (++this.brood.kills % 3 === 1) word(pick(['SQUISH!', 'SPLAT!', 'EWW!']), x, y - 12, null, 22);
		sfx('splat');
	}
}
function hatch() {
	const spots = [[.06, .12], [.94, .12], [.06, .88], [.94, .88], [.5, .07]], c = pick(spots);
	const x = clamp(c[0] * W, 50, W - 50), y = clamp(c[1] * H, 50, H - 50);
	const sac = svgBit('<path d="M-15 0L-34-9M15-1L34-12M0-12L5-30M-10 9L-26 22M11 9L24 24" stroke="var(--thread)" stroke-width=".8"/>'
		+ '<g class="egg"><ellipse rx="15" ry="12.5" fill="url(#tth-sac)"/><ellipse rx="15" ry="12.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-dasharray=".6 1.6" opacity=".7"/>'
		+ '<ellipse cx="-5" cy="-5" rx="5" ry="3" fill="#fff" opacity=".7"/><path class="split" d="M-9-5Q0-13 9-5Q0 1-9-5Z" fill="#3a2a1a" opacity="0"/></g>', 80, 80, stage);
	sac.style.transform = 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0)';
	const egg = sac.querySelector('.egg');
	egg.animate([{ transform: 'scale(.2)' }, { transform: 'scale(1.08)', offset: .2 }, { transform: 'scale(1) rotate(0)', offset: .3 },
		{ transform: 'rotate(-5deg)', offset: .45 }, { transform: 'rotate(6deg)', offset: .55 }, { transform: 'rotate(-9deg)', offset: .68 },
		{ transform: 'rotate(10deg) scale(1.04)', offset: .8 }, { transform: 'rotate(-12deg) scale(1.08)', offset: .9 }, { transform: 'rotate(0) scale(1.12)' }],
		{ duration: 1700, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => {
		sac.querySelector('.split').style.opacity = 1;
		egg.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(.85,.7)' }], { duration: 300, fill: 'forwards' });
		const brood = { kills: 0 }, toward = Math.atan2(H / 2 - y, W / 2 - x);
		for (let i = 0, n = irand(9, 13); i < n; i++) setTimeout(() => { if (!doc.hidden) new Mini(x + rand(-4, 4), y + rand(-4, 4), toward + rand(-1.5, 1.5), brood); }, i * rand(25, 70));
		setTimeout(() => sac.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1200, fill: 'forwards' }).onfinish = () => sac.remove(), 1600);
	};
	return true;
}

/* ------------------------------------------------------------------------------------------------ bats */

addDefs(`
<radialGradient id="tth-batfur" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#4c3f58"/><stop offset=".6" stop-color="#1c1522"/><stop offset="1" stop-color="#09060c"/></radialGradient>
<linearGradient id="tth-wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c2236"/><stop offset="1" stop-color="#0f0a14"/></linearGradient>
`);
addCSS(`
.bat .wm{fill:url(#tth-wing)}
.bat .wb{fill:none;stroke:#433651;stroke-width:.7;stroke-linecap:round}
:host([data-theme=light]) .bat .wb{stroke:#2a2233}
`);
function batSVG() {
	const wing = '<path class="wm rim" d="M-3-4C-10-14-22-18-32-14L-46-9Q-40-4-40 4Q-35 0-30 8Q-25 3-19 9Q-13 3-8 6Q-5 3-3 2Z"/>'
		+ '<path class="wb" d="M-3-4L-32-14M-32-14L-46-9M-32-14L-40 4M-32-14L-30 8M-32-14L-19 9"/>';
	return '<g class="wl">' + wing + '</g><g transform="scale(-1,1)"><g class="wr">' + wing + '</g></g>'
		+ '<ellipse class="rim" cy="3" rx="5.4" ry="8.6" fill="url(#tth-batfur)"/>'
		+ '<path class="rim" d="M-4.6-10.5L-6.4-18.8L-1.3-12.6ZM4.6-10.5L6.4-18.8L1.3-12.6Z" fill="#1d1622"/>'
		+ '<circle class="rim" cy="-8.2" r="5.4" fill="url(#tth-batfur)"/>'
		+ '<circle cx="-2.1" cy="-8.8" r="3.2" fill="url(#tth-eyeglow)"/><circle cx="2.1" cy="-8.8" r="3.2" fill="url(#tth-eyeglow)"/>'
		+ '<g class="eyes"><circle cx="-2.1" cy="-8.8" r="1.1" fill="#ff5440"/><circle cx="2.1" cy="-8.8" r="1.1" fill="#ff5440"/></g>'
		+ '<path d="M-1.4-5.3l.45 1.5.45-1.3M.5-5.3l.45 1.3.45-1.5" fill="#fff"/>'
		+ '<path d="M-2.2 11.6l-.7 1.9M2.2 11.6l.7 1.9" stroke="#1d1622" stroke-width=".9" stroke-linecap="round"/>'
		+ '<ellipse class="hit" rx="26" ry="16" fill="transparent"/>';
}

// Flaps across in jerky swoops, swerves away from the mouse; some hang upside down from the top of the screen for a
// while, wings folded, until something disturbs them. They also come in swarms, the far ones smaller and dimmer.
class Bat {
	constructor(o) {
		o = o || {};
		this.kind = 'bat'; this.alive = true; this.t = 0; this.tiny = !!o.tiny; this.scareable = !o.tiny;
		this.depth = o.depth || rand(.8, 1.1);
		this.s = this.depth * (o.tiny ? .5 : 1.1) * fit(.8);
		this.el = creatureEl(110, 'bat', batSVG());
		this.el.style.zIndex = Math.round(this.depth * 100);
		if (this.depth < .8) this.el.style.opacity = (.45 + this.depth * .5).toFixed(2);
		this.wl = this.el.querySelector('.wl'); this.wr = this.el.querySelector('.wr'); this.eyes = this.el.querySelector('.eyes');
		const side = o.side != null ? o.side : chance(.5) ? 1 : 3;
		this.x = o.x != null ? o.x : side === 1 ? W + 60 : -60;
		this.y = o.y != null ? o.y : rand(.08, .6) * H;
		this.wps = o.wps || [{ x: rand(.25, .75) * W, y: clamp(this.y + rand(-.25, .25) * H, 40, H * .75) }, { x: side === 1 ? -90 : W + 90, y: rand(.05, .6) * H }];
		this.wi = 0;
		this.v = (o.v || rand(170, 260)) * (.6 + this.depth * .4);
		this.vx = (side === 1 ? -1 : 1) * this.v; this.vy = 0;
		if (o.vx != null) { this.vx = o.vx; this.vy = o.vy; this.v = hypot(o.vx, o.vy); this.wps = [{ x: this.x + o.vx * 8, y: this.y + o.vy * 8 }]; }
		this.fl = rand(0, TAU); this.ff = rand(7.5, 10); this.jinkT = 0; this.jx = 0; this.jy = 0; this.fold = 0; this.flip = 0;
		this.mode = 'fly';
		if (o.hang) { this.mode = 'tohang'; this.hx = rand(.15, .85) * W; this.wps = [{ x: this.hx, y: 30 }]; }
		this.wings(0, 0); this.draw(0);
		enlist(this);
	}
	// wing angle about the shoulder; fold 1 = tucked against the body
	wings(up, fold) {
		const ang = lerp(up * 42 - 4, -80, fold), sx = lerp(1, .36, fold), sy = lerp(.74 + .26 * Math.cos(this.fl), 1, fold);
		const t = 'rotate(' + n1(ang) + ' -3 -4) translate(-3 -4) scale(' + sx.toFixed(2) + ' ' + sy.toFixed(2) + ') translate(3 4)';
		this.wl.setAttribute('transform', t);
		this.wr.setAttribute('transform', t);
	}
	draw(tilt) { place(this.el, this.x, this.y, tilt + this.flip * Math.PI, this.s); }
	update(dt) {
		this.t += dt;
		if (!this.alive) return this.dying(dt);
		if (this.mode === 'hang') return this.hanging(dt);
		const wp = this.wps[this.wi], dx = wp.x - this.x, dy = wp.y - this.y, d = hypot(dx, dy) || 1;
		if (d < 40) {
			if (this.mode === 'tohang') { this.mode = 'hang'; this.t0 = this.t; this.hangT = rand(2.5, 4.5); return true; }
			if (this.wi < this.wps.length - 1) this.wi++;
		}
		if ((this.jinkT -= dt) <= 0) { this.jinkT = rand(.25, .8); this.jx = rand(-1, 1) * this.v * .55; this.jy = rand(-1, 1) * this.v * .5; }
		if (!this.tiny && pointerNear(this.x, this.y, 110)) { this.jx = (this.x - P.x) * 5; this.jy = (this.y - P.y) * 5; this.jinkT = .35; }
		const k = Math.min(1, dt * 2.6);
		this.vx += (dx / d * this.v + this.jx - this.vx) * k;
		this.vy += (dy / d * this.v + this.jy - this.vy) * k;
		this.fl += dt * TAU * this.ff;
		this.x += this.vx * dt;
		this.y += this.vy * dt + Math.sin(this.fl) * 24 * dt;   // each downstroke lifts it a little
		this.fold = Math.max(0, this.fold - dt * 3);
		this.wings(Math.sin(this.fl), this.fold);
		this.draw(clamp(this.vx * .0014, -.4, .4));
		return !(this.wi === this.wps.length - 1 && this.t > 1.5 && !onScreen(this.x, this.y, 70)) && this.t < 40;
	}
	hanging(dt) {
		const t = this.t - this.t0;
		if (t < .4) this.flip = this.fold = ease.inOut(t / .4);   // turns over and folds up
		if (pointerNear(this.x, this.y, 90) && this.hangT > t + .2) this.hangT = t + .2;   // disturbed: lets go
		if (t > this.hangT) {   // drops, opens its wings, flies off
			this.mode = 'fly'; this.flip = 0; this.vx = 0; this.vy = 140; this.t = 1;
			this.wps = [{ x: chance(.5) ? -90 : W + 90, y: rand(.2, .6) * H }]; this.wi = 0;
			return true;
		}
		const sway = Math.sin(t * 2.2) * .07;
		this.x = this.hx + sway * 12;
		this.y = lerp(this.y, 14 * this.s, Math.min(1, dt * 6));
		this.wings(0, this.fold);
		this.eyes.setAttribute('transform', t % 2.7 > 2.55 ? 'translate(0 -8.8) scale(1 .15) translate(0 8.8)' : '');
		place(this.el, this.x, this.y, Math.PI * this.flip + sway, this.s);
		return true;
	}
	hit(x, y) {
		this.alive = false; this.dt = 0;
		this.el.classList.add('dead');
		noteKill(this);
		if (!this.tiny && chance(.4)) {   // a puff of smoke, and two little bats escape from it
			this.how = 'poof';
			this.el.style.opacity = 0;
			smoke(this.x, this.y, 10, 1.1);
			word('POOF!', x, y - 18);
			sfx('poof');
			for (const dir of [-1, 1]) new Bat({ tiny: true, x: this.x, y: this.y, vx: dir * rand(220, 300), vy: rand(-240, -120), depth: 1 });
		} else {   // knocked silly: stars, a spin, a fall
			this.how = 'dizzy';
			this.vx *= .3; this.vy = -140; this.spin = rand(4, 7) * (chance(.5) ? 1 : -1);
			word(pick(['BONK!', 'EEK!', 'THWACK!']), x, y - 18);
			sfx('squeak');
			setTimeout(() => sfx('bonk'), 90);
			dizzy(this);
		}
	}
	dying(dt) {
		const t = this.dt += dt;
		if (this.how === 'poof') return t < .1;
		this.vy += 1100 * dt;
		this.x += this.vx * dt; this.y += this.vy * dt;
		this.flip += this.spin * dt / Math.PI;
		this.wings(.2, Math.min(1, t * 2) * .6);
		this.draw(0);
		if (t > 1.2) this.el.style.opacity = Math.max(0, 1 - (t - 1.2) / .5);
		return t < 1.7 && this.y < H + 90;
	}
	startle() { if (this.alive && this.mode === 'hang') this.hangT = 0; }
}
// three stars circling over a knocked-out head
function dizzy(c) {
	const st = [0, 1, 2].map(() => svgBit('<g fill="#ffd84a" stroke="#7a5200" stroke-width=".6">' + STAR + '</g>', 14, 14));
	let t = 0;
	fx(dt => {
		t += dt;
		const done = !live.has(c) || t > 1.5;
		st.forEach((s, i) => {
			if (done) { s.remove(); return; }
			const a = t * 8 + i * TAU / 3;
			s.style.transform = 'translate3d(' + n1(c.x + Math.cos(a) * 17) + 'px,' + n1(c.y - 24 + Math.sin(a) * 5) + 'px,0) scale(.85)';
		});
		return !done;
	});
}
function colony() {
	const n = irand(4, 7), side = chance(.5) ? 1 : 3, y0 = rand(.12, .5) * H, exitY = rand(.05, .55) * H;
	for (let i = 0; i < n; i++) setTimeout(() => {
		if (doc.hidden) return;
		new Bat({
			side, y: clamp(y0 + rand(-90, 90), 20, H - 60), depth: rand(.45, 1.05), v: rand(240, 310),
			wps: [{ x: W * rand(.35, .65), y: clamp(y0 + rand(-120, 120), 30, H * .7) }, { x: side === 1 ? -90 : W + 90, y: exitY + rand(-60, 60) }],
		});
	}, i * rand(90, 380));
	return true;
}

/* ------------------------------------------------------------------------------------------------ ghosts */

addDefs(`
<linearGradient id="tth-ghost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#eef1ff"/><stop offset="1" stop-color="#d4dcfa" stop-opacity=".5"/></linearGradient>
<radialGradient id="tth-gglow"><stop offset="0" stop-color="#e6ecff" stop-opacity=".55"/><stop offset=".55" stop-color="#bfcaff" stop-opacity=".18"/><stop offset="1" stop-color="#a5b4fc" stop-opacity="0"/></radialGradient>
`);
addCSS(`
.gh .gb{stroke:rgba(150,165,230,.5);stroke-width:.8}
:host([data-theme=light]) .gh .gb{stroke:#8a94bd;stroke-width:1.1}
:host([data-theme=light]) .gh .glow{opacity:.45}
`);
function ghostSVG() {
	return '<circle class="glow" cy="-2" r="46" fill="url(#tth-gglow)"/>'
		+ '<path class="gb" fill="url(#tth-ghost)" d="' + ghostPath(0, 0) + '"/>'
		+ '<g class="face"><ellipse cx="-9" cy="-12" rx="4.3" ry="6.2" fill="#1d1730"/><ellipse cx="9" cy="-12" rx="4.3" ry="6.2" fill="#1d1730"/>'
		+ '<circle cx="-7.8" cy="-14.4" r="1.3" fill="#fff"/><circle cx="10.2" cy="-14.4" r="1.3" fill="#fff"/>'
		+ '<ellipse class="mouth" cy="3" rx="3.6" ry="4.6" fill="#1d1730"/>'
		+ '<ellipse cx="-14.5" cy="-3" rx="3.4" ry="2" fill="#ff8fbf" opacity=".35"/><ellipse cx="14.5" cy="-3" rx="3.4" ry="2" fill="#ff8fbf" opacity=".35"/></g>'
		+ '<ellipse class="hand gb" rx="6.4" ry="4.8" fill="url(#tth-ghost)"/><ellipse class="hand gb" rx="6.4" ry="4.8" fill="url(#tth-ghost)"/>'
		+ '<ellipse class="hit" cy="-2" rx="30" ry="38" fill="transparent"/>';
}
// the sheet: a dome with a hem that ripples, leaning against the way it drifts
function ghostPath(t, lean) {
	let d = 'M-26 -4C-26 -39 26 -39 26 -4L' + n1(26 + lean) + ' 24';
	for (let i = 0; i < 6; i++) {
		const x0 = 26 + lean - i * 52 / 6, x1 = x0 - 52 / 6;
		d += 'Q' + n1((x0 + x1) / 2) + ' ' + n1(33 + 4 * Math.sin(t * 3.4 + i * 1.3)) + ' ' + n1(x1) + ' ' + n1(24 + 3 * Math.sin(t * 3.4 + (i + 1) * 1.3));
	}
	return d + 'Z';
}

// Fades in at the side of the screen and drifts along, bobbing. Shy: covers its eyes and turns see-through when the
// mouse comes close. Now and then one shouts BOO at the mouse instead, laughs and flees.
class Ghost {
	constructor(o) {
		o = o || {};
		this.kind = 'ghost'; this.alive = true; this.t = rand(0, 10); this.age = 0; this.mini = !!o.mini; this.scareable = !o.mini;
		this.s = (o.mini ? .42 : rand(.85, 1.1)) * fit(.8);
		this.el = creatureEl(110, 'gh', ghostSVG());
		this.body = this.el.querySelector('.gb'); this.hands = this.el.querySelectorAll('.hand'); this.mouth = this.el.querySelector('.mouth');
		this.dir = o.dir || (chance(.5) ? 1 : -1);
		this.x = o.x != null ? o.x : this.dir > 0 ? -30 : W + 30;
		this.y0 = this.y = o.y != null ? o.y : rand(.15, .72) * H;
		this.vx = o.vx != null ? o.vx : this.dir * rand(38, 62);
		this.vy = o.vy || 0;
		this.life = o.mini ? rand(3, 5) : rand(11, 18); this.shy = 0; this.booT = 0; this.boo = !o.mini && chance(.28);
		this.turn = !o.mini && chance(.35) ? rand(.3, .6) : 0;   // changes its mind halfway
		this.update(0);
		enlist(this);
	}
	update(dt) {
		this.t += dt; this.age += dt;
		if (!this.alive) return this.dying(dt);
		const near = !this.mini && pointerNear(this.x, this.y, 150 * this.s + 20);
		if (near && this.boo && !this.booT) {
			this.booT = .001;
			word('BOO!', this.x, this.y - 40 * this.s, '#e9e3ff', 40);
			this.vx = Math.sign(this.x - P.x || 1) * 18;
		}
		let mouthRx = 3.6, mouthRy = 4.6;
		if (this.booT) {   // mouth wide open, then a fit of laughter, then off it goes
			this.booT += dt;
			if (this.booT < .5) { mouthRx = 7; mouthRy = 10.5; }
			else { mouthRx = 5; mouthRy = 5 + 3.5 * Math.abs(Math.sin(this.booT * 14)); }
			if (this.booT > 1.3 && Math.abs(this.vx) < 100) { this.vx = (this.x < W / 2 ? -1 : 1) * 260; this.life = this.age + 1.5; }
		}
		this.shy = clamp(this.shy + (near && !this.booT ? 1 : -1) * dt * 3.5, 0, 1);
		if (this.turn && (this.dir > 0 ? this.x > this.turn * W : this.x < (1 - this.turn) * W)) { this.turn = 0; this.vx = -this.vx; this.dir = -this.dir; }
		this.x += this.vx * (1 - this.shy * .6) * dt;
		this.y0 += this.vy * dt;
		this.y = this.y0 + Math.sin(this.t * .9) * 22 + Math.sin(this.t * 2.1) * 5;
		const out = this.age > this.life ? Math.max(0, 1 - (this.age - this.life) / 1.4) : 1;
		const op = Math.min(1, this.age / 1.4) * lerp(.94, .3, this.shy) * out;
		this.el.style.opacity = op.toFixed(3);
		this.body.setAttribute('d', ghostPath(this.t, clamp(-this.vx * .06, -7, 7)));
		const k = ease.inOut(this.shy);
		this.hands[0].setAttribute('transform', 'translate(' + n1(lerp(-27, -9, k)) + ' ' + n1(lerp(7 + Math.sin(this.t * 3) * 2, -12, k)) + ') rotate(' + n1(lerp(-30, 10, k)) + ')');
		this.hands[1].setAttribute('transform', 'translate(' + n1(lerp(27, 9, k)) + ' ' + n1(lerp(7 + Math.sin(this.t * 3 + 1) * 2, -12, k)) + ') rotate(' + n1(lerp(30, -10, k)) + ')');
		this.mouth.setAttribute('rx', n1(mouthRx)); this.mouth.setAttribute('ry', n1(mouthRy));
		place(this.el, this.x, this.y, clamp(this.vx * .002, -.14, .14), this.s);
		return out > 0 && (this.age < 3 || onScreen(this.x, this.y, 60));
	}
	hit(x, y) {
		this.alive = false; this.dt = 0;
		this.el.classList.add('dead');
		noteKill(this);
		if (this.mini) { this.how = 'pop'; smoke(this.x, this.y, 5, .6, 'rgba(235,238,255,.9)'); word('POP!', x, y - 10, '#e9e3ff', 20); sfx('pop'); return; }
		if (chance(.4)) {   // splits into three little ghosts that zip off giggling
			this.how = 'pop';
			smoke(this.x, this.y, 7, .9, 'rgba(235,238,255,.9)');
			word(pick(['HEE HEE!', 'NOPE!']), x, y - 30, '#e9e3ff');
			sfx('giggle');
			for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 1.1 + rand(-.2, .2), v = rand(160, 230); new Ghost({ mini: true, x: this.x, y: this.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6 }); }
		} else {   // exorcised: spins down into a wisp
			this.how = 'swirl';
			word(pick(['BANISHED!', 'BEGONE!', 'POOF!']), x, y - 30, '#e9e3ff');
			sfx('wail');
		}
	}
	dying(dt) {
		const t = this.dt += dt;
		if (this.how === 'pop') return t < .05;
		const k = Math.min(1, t / .9);
		this.y -= 40 * dt;
		this.el.style.opacity = (1 - k) * .9;
		place(this.el, this.x, this.y, k * k * 14, this.s * (1 - ease.in(k) * .85));
		if (Math.random() < dt * 40) sparkle(this.x + rand(-20, 20), this.y + rand(-20, 20), chance(.5) ? '#ffffff' : '#c7d2fe', .8, { vy: rand(-90, -40) });
		return k < 1;
	}
	startle() { if (this.alive) this.life = Math.min(this.life, this.age); }
}

/* ------------------------------------------------------------------------------------------------ eyes in the dark */

addDefs(`
<radialGradient id="tth-dark"><stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset=".55" stop-color="#05030a" stop-opacity=".68"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="tth-eyeY" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#fffbd0"/><stop offset=".45" stop-color="#ffe14a"/><stop offset="1" stop-color="#d98e00"/></radialGradient>
<radialGradient id="tth-eyeR" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#ffd8d0"/><stop offset=".45" stop-color="#ff4a3a"/><stop offset="1" stop-color="#9b0f06"/></radialGradient>
<radialGradient id="tth-eyeG" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#f1ffd8"/><stop offset=".45" stop-color="#8dff4a"/><stop offset="1" stop-color="#2f8f06"/></radialGradient>
<radialGradient id="tth-greenglow"><stop offset="0" stop-color="#b6ff5a" stop-opacity=".75"/><stop offset=".4" stop-color="#7dff3a" stop-opacity=".3"/><stop offset="1" stop-color="#5ad11f" stop-opacity="0"/></radialGradient>
`);
const EYE_PAIR = [[-13, 0, 1], [13, 0, 1]];
const EYE_SPIDER = [[-17, -2, .5], [17, -2, .5], [-7, -7, .68], [7, -7, .68], [-6, 6, .42], [6, 6, .42]];
const EYE_COLORS = { y: ['tth-eyeY', 'tth-goldglow'], r: ['tth-eyeR', 'tth-eyeglow'], g: ['tth-eyeG', 'tth-greenglow'] };   // the eye, its glow
function eyesSVG(c, layout) {
	const [grad, glow] = EYE_COLORS[c];
	let eyes = '';
	for (const [x, y, s] of layout) {
		eyes += '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><circle r="16" fill="url(#' + glow + ')" opacity=".55"/>'
			+ '<g class="lid"><path d="M-10 0Q0-7.5 10 0Q0 7.5-10 0Z" fill="url(#' + grad + ')"/><ellipse class="pupil" rx="1.5" ry="5.4" fill="#120800"/>'
			+ '<circle cx="-3" cy="-2.2" r="1.1" fill="#fff" opacity=".8"/></g></g>';
	}
	return '<ellipse class="dark" rx="64" ry="46" fill="url(#tth-dark)"/>' + eyes + '<ellipse class="hit" rx="40" ry="24" fill="transparent"/>';
}
// A pair of eyes opens in a patch of darkness at the edge of the screen, blinks and follows the mouse, and is gone
// the moment the mouse comes for it. (watch: the quiet-spell watchers that only leave when the visitor stirs)
class Eyes {
	constructor(o) {
		o = o || {};
		this.kind = 'eyes'; this.alive = true; this.scareable = true; this.t = 0; this.watch = !!o.watch;
		this.color = o.color || pick(['y', 'y', 'r', 'g']);
		this.s = rand(.85, 1.15) * fit(.8);
		this.el = creatureEl(140, 'ey', eyesSVG(this.color, chance(.25) ? EYE_SPIDER : EYE_PAIR));
		this.lids = this.el.querySelectorAll('.lid'); this.pupils = this.el.querySelectorAll('.pupil');
		const side = this.side = o.side != null ? o.side : irand(0, 3);
		const p = side === 0 ? { x: rand(.1, .9) * W, y: 16 } : side === 1 ? { x: W - 20, y: rand(.15, .85) * H }
			: side === 2 ? { x: rand(.2, .9) * W, y: H - 20 } : { x: 20, y: rand(.15, .85) * H };
		this.x = this.x0 = p.x; this.y = this.y0 = p.y;
		this.life = o.life || rand(5, 10); this.blinkAt = rand(1.4, 3); this.leave = 0; this.lx = 0; this.ly = 0; this.wph = rand(0, 9);
		this.update(0);
		enlist(this);
	}
	update(dt) {
		this.t += dt;
		if (!this.alive) return this.dying(dt);
		if (!this.leave && (this.t > this.life || (!this.watch && this.t > 1 && pointerNear(this.x, this.y, 110)))) this.leave = this.t;
		let op = Math.min(1, this.t / 1.2), open = clamp((this.t - .7) * 3, 0, 1), back = 0;
		if (this.leave) {
			const k = Math.min(1, (this.t - this.leave) / .45);
			op *= 1 - k; open *= Math.max(0, 1 - k * 2.5); back = ease.in(k) * 40;
			if (k >= 1) return false;
		}
		let lid = open;
		if (this.t > this.blinkAt) {
			const b = (this.t - this.blinkAt) / .17;
			if (b < 1) lid *= Math.abs(b - .5) * 2;
			else this.blinkAt = this.t + (chance(.25) ? .25 : rand(1.5, 4));
		}
		let tx, ty;
		if (P.on) { const a = Math.atan2(P.y - this.y, P.x - this.x), d = Math.min(1, hypot(P.x - this.x, P.y - this.y) / 180); tx = Math.cos(a) * 4 * d; ty = Math.sin(a) * 2.6 * d; }
		else { tx = Math.sin(this.t * .7 + this.wph) * 3.5; ty = Math.sin(this.t * .43) * 1.6; }
		this.lx += (tx - this.lx) * Math.min(1, dt * 8 || 1); this.ly += (ty - this.ly) * Math.min(1, dt * 8 || 1);
		const lt = 'scale(1 ' + Math.max(.04, lid).toFixed(2) + ')', pt = 'translate(' + n1(this.lx) + ' ' + n1(this.ly) + ')';
		this.lids.forEach(l => l.setAttribute('transform', lt));
		this.pupils.forEach(p => p.setAttribute('transform', pt));
		const ox = [0, 1, 0, -1][this.side] * back, oy = [-1, 0, 1, 0][this.side] * back;
		this.x = this.x0 + ox; this.y = this.y0 + oy;
		this.el.style.opacity = op.toFixed(3);
		place(this.el, this.x, this.y, 0, this.s);
		return true;
	}
	hit(x, y) {
		this.alive = false; this.dt = 0;
		this.el.classList.add('dead');
		noteKill(this);
		word(pick(['OW!', 'MY EYES!', 'OUCH!']), x, y - 24, '#ffe14a');
		sfx('ouch');
	}
	dying(dt) {   // squeezed shut, shaking, gone
		const t = this.dt += dt, k = Math.min(1, t / .55);
		this.lids.forEach(l => l.setAttribute('transform', 'scale(1.1 .06)'));
		this.el.style.opacity = (1 - ease.in(k)).toFixed(3);
		place(this.el, this.x + Math.sin(t * 70) * 3 * (1 - k), this.y, 0, this.s * (1 - k * .4));
		return k < 1;
	}
	startle() { if (this.alive && !this.leave) this.leave = this.t; }
}

/* ------------------------------------------------------------------------------------------------ the zombie hand */

addDefs(`
<linearGradient id="tth-skin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a7550"/><stop offset=".5" stop-color="#93ab80"/><stop offset="1" stop-color="#4b6444"/></linearGradient>
<linearGradient id="tth-sleeve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b2622"/><stop offset=".5" stop-color="#4a423a"/><stop offset="1" stop-color="#26211d"/></linearGradient>
<linearGradient id="tth-soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5139"/><stop offset="1" stop-color="#2a1f15"/></linearGradient>
`);
// one finger: two tapered segments (the lower one bends as a whole for a fist) and a broken nail
function zFinger(x, y, rot, l1, l2, w, cls) {
	const v = w * .86, seg = (ww, l) => 'M' + n1(-ww / 2) + ' 2.5L' + n1(-ww * .46) + ' ' + n1(2.4 - l) + 'Q0 ' + n1(-l - 1.6) + ' ' + n1(ww * .46) + ' ' + n1(2.4 - l) + 'L' + n1(ww / 2) + ' 2.5Z';
	return '<g class="f' + (cls || '') + '" data-l="' + l1 + '" data-x="' + x + '" data-y="' + y + '" data-r="' + rot + '" transform="translate(' + x + ' ' + y + ') rotate(' + rot + ')"><g class="p1">'
		+ '<path d="' + seg(w, l1) + '" fill="url(#tth-skin)"/><path d="M' + n1(-w * .28) + ' ' + n1(3.5 - l1) + 'q' + n1(w * .28) + ' 1.3 ' + n1(w * .56) + ' 0" stroke="#3d5035" stroke-width=".7" fill="none"/>'
		+ '<g class="p2" transform="translate(0 ' + n1(1.5 - l1) + ')"><path d="' + seg(v, l2) + '" fill="url(#tth-skin)"/>'
		+ '<path d="M' + n1(-v * .34) + ' ' + n1(4.8 - l2) + 'L' + n1(-v * .36) + ' ' + n1(1.2 - l2) + 'L' + n1(-v * .1) + ' ' + n1(-.2 - l2) + 'L0 ' + n1(1.2 - l2) + 'L' + n1(v * .14) + ' ' + n1(-.3 - l2)
		+ 'L' + n1(v * .36) + ' ' + n1(1.2 - l2) + 'L' + n1(v * .34) + ' ' + n1(4.8 - l2) + 'Z" fill="#37321f"/></g></g></g>';
}
// the back of a rotting hand, fingers a little fanned out, coming up out of a torn sleeve
function handSVG() {
	return '<g transform="translate(0 -40)"><g class="flag" opacity="0"><path d="M-1-24V-98" stroke="#6b4a2a" stroke-width="2.2" stroke-linecap="round"/>'
		+ '<path class="cloth" d="M0-98Q14-102 28-96Q16-89 28-82Q14-86 0-80Z" fill="#fbfaf5" stroke="#c9c4b5" stroke-width=".8"/></g>'
		+ '<path class="rim" d="M-12.5 96C-13.5 60-12.5 22-11.5 2C-5-2 5-2 11.5 2C12.5 22 13.5 60 13.5 96Z" fill="url(#tth-skin)"/>'
		+ '<path d="M-4 12C-3 26-3 36-4 46M4 10C4 22 5 34 4 44" stroke="#4d6445" stroke-width=".9" fill="none" opacity=".6"/>'
		+ '<path d="M-8 24l5 2.5M-7.6 29l5-1.6M-7.4 34l5 2.4M-6.6 20l2.6 18" stroke="#2a3825" stroke-width=".9" fill="none" stroke-linecap="round"/>'
		+ '<ellipse cx="6" cy="30" rx="3.4" ry="5" fill="#4a3a2c" opacity=".55"/>'
		+ '<path class="rim" d="M-17 0C-18.5-14-17.5-24-15.5-30L15.5-30C17.5-24 18.5-14 17 0C10 6.5-10 6.5-17 0Z" fill="url(#tth-skin)"/>'
		+ '<path d="M-9-27C-8-18-6-8-3-2M-1.5-28C-1-18 0-8 1-1M6-27C5-18 4-9 3-2M12.5-25C10-16 8-8 5-2" stroke="#4d6445" stroke-width=".8" fill="none" opacity=".55"/>'
		+ '<ellipse cx="-7" cy="-13" rx="4.4" ry="2.8" fill="#4a5c3d" opacity=".55"/><path d="M6-12c2-2 5-1 5 1.6s-3 3.4-5 2.4-1.6-2.6 0-4z" fill="#5a2a20" opacity=".8"/>'
		+ zFinger(-12.6, -29, -9, 14, 12, 7.6) + zFinger(-4.3, -30, -3, 16, 13.5, 7.8) + zFinger(4.3, -30, 3, 15, 13, 7.6) + zFinger(12.3, -28, 10, 11.5, 10, 6.8)
		+ zFinger(-16, -11, -52, 11, 9.5, 8, ' th')
		+ '<g class="knk" fill="#a9be97" opacity=".55"><ellipse cx="-12.4" cy="-29" rx="2.8" ry="1.5"/><ellipse cx="-4.3" cy="-30" rx="2.9" ry="1.5"/><ellipse cx="4.3" cy="-30" rx="2.9" ry="1.5"/><ellipse cx="12.2" cy="-28" rx="2.5" ry="1.4"/></g>'
		+ '<path d="M-20 46l3 6 3-5 3 8 3-6 4 7 3-8 3 6 4-6 3 7 4-5L22 100L-22 100Z" fill="url(#tth-sleeve)"/>'
		+ '<path d="M-9 53q1.4 8-.8 15M8 52q-1 6 .6 11" stroke="#2b2622" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
		+ '<rect class="hit" x="-24" y="-74" width="48" height="124" rx="16" fill="transparent"/></g>';
}
// Pushes up out of the bottom of the screen, fingers twitching, gropes for the mouse (and grabs at it), then sinks
// back. Hit it and it shakes it off, then waves goodbye or a little white flag on the way down.
class Hand {
	constructor() {
		this.kind = 'hand'; this.alive = true; this.scareable = true; this.t = 0;
		this.s = rand(.95, 1.15) * fit(.8);
		this.el = creatureEl(140, 'hd', handSVG());
		this.fingers = [...this.el.querySelectorAll('.f')].map(g => ({ g, p1: g.querySelector('.p1'), p2: g.querySelector('.p2'), l: +g.dataset.l, x: +g.dataset.x, y: +g.dataset.y, r: +g.dataset.r, th: g.classList.contains('th'), c: 0, ct: 0, nt: 0 }));
		this.flag = this.el.querySelector('.flag'); this.cloth = this.el.querySelector('.cloth');
		this.x = rand(Math.min(140, W * .3), W - 90); this.rise = 0; this.life = rand(4.5, 7); this.rot = 0; this.waves = chance(.3); this.after = '';
		// the earth it pushes up through, at the bottom edge of the screen
		this.mound = svgBit('<path d="M-50 16C-42-3-24-11 0-11C24-11 42-3 50 16Z" fill="url(#tth-soil)"/><g fill="#3a2a1b"><circle cx="-21" cy="-4" r="3.2"/>'
			+ '<circle cx="15" cy="-7" r="2.5"/><circle cx="30" cy="1" r="2.2"/><circle cx="-35" cy="4" r="2.4"/><circle cx="2" cy="-9" r="1.8"/></g>'
			+ '<path d="M-28 2l-2-9M-26 2l1-8M24 0l3-8M26 1l-1-7" stroke="#3f5a2a" stroke-width="1.2" stroke-linecap="round"/>', 110, 40, stage);   // in front of the arm
		this.update(0);
		enlist(this);
	}
	update(dt) {
		this.t += dt;
		const t = this.t, sinking = this.alive ? t > this.life : t > this.hitT + 1.6;
		if (sinking) { this.rise = Math.max(0, this.rise - dt * (this.alive ? 1.2 : 1.8)); if (this.rise <= 0) return false; }
		else this.rise = Math.min(1, this.rise + dt / 1.2);
		const m = Math.min(1, this.rise * 2.5);
		this.mound.style.opacity = m.toFixed(2);
		this.mound.style.transform = 'translate3d(' + n1(this.x) + 'px,' + n1(H - 4 * this.s) + 'px,0) scale(' + (this.s * .9).toFixed(2) + ',' + (this.s * m * .9).toFixed(2) + ')';
		if (this.alive && t < 1.1 && Math.random() < dt * 30) {   // the ground it pushes through
			const d = dot(irand(3, 6), chance(.5) ? '#5a4632' : '#3d2f22');
			particle(d, this.x + rand(-22, 22) * this.s, H - 2, { vx: rand(-90, 90), vy: rand(-320, -150), g: 900, life: rand(.5, .8), fade: .5 });
		}
		let aim = 0, grab = false;
		if (this.alive && pointerNear(this.x, H - 60 * this.s, 190)) { aim = clamp(Math.atan2(P.x - this.x, (H - 40) - P.y) * .6, -.5, .5); grab = pointerNear(this.x + Math.sin(this.rot) * 70 * this.s, H - 75 * this.s, 75); }
		else if (this.waves && this.alive && t > 1.4 && t < 3) aim = Math.sin(t * 7) * .28;
		else aim = Math.sin(t * 1.3) * .08;
		const after = !this.alive && t - this.hitT > .5 ? this.after : '';
		if (!this.alive && t - this.hitT < .5) aim = Math.sin((t - this.hitT) * 45) * .2 * (1 - (t - this.hitT) / .5);   // shakes off the hit
		else if (after === 'wave') aim = Math.sin((t - this.hitT) * 11) * .32;   // waves goodbye on the way down
		this.rot += (aim - this.rot) * Math.min(1, dt * 8 || 1);
		for (const f of this.fingers) {
			if (after) f.ct = after === 'wave' ? 0 : (f.th ? .6 : .85);   // wide open to wave, or closed round the flagpole
			else if (grab) f.ct = f.th ? .5 : .95;
			else if ((f.nt -= dt) <= 0) { f.nt = rand(.25, 1); f.ct = chance(.25) ? rand(.15, .3) : rand(0, .12); }   // twitching, mostly open
			f.c += (f.ct - f.c) * Math.min(1, dt * 9 || 1);
			if (f.th) {   // the thumb swings in towards the palm as the hand closes
				f.rot = f.r + f.c * 38;
				f.g.setAttribute('transform', 'translate(' + f.x + ' ' + f.y + ') rotate(' + n1(f.rot) + ')');
			} else {   // a curling finger is seen end-on: the first segment shortens, the second folds down over it
				f.p1.setAttribute('transform', 'scale(1 ' + (1 - .62 * f.c).toFixed(2) + ')');
				f.p2.setAttribute('transform', 'translate(0 ' + n1(1.5 - f.l) + ') scale(1 ' + (1 - 2 * f.c).toFixed(2) + ')');
			}
		}
		if (this.after === 'flag') {
			this.flag.setAttribute('opacity', Math.min(1, (t - this.hitT - .5) * 4).toFixed(2));
			const w = Math.sin(t * 9) * 4;
			this.cloth.setAttribute('d', 'M0-96Q14 ' + n1(-100 + w) + ' 28 ' + n1(-94 - w) + 'Q16 ' + n1(-87 + w) + ' 28 ' + n1(-80 - w) + 'Q14 ' + n1(-84 + w) + ' 0-78Z');
		}
		const shake = this.rise < 1 && !sinking ? Math.sin(t * 60) * 1.5 : 0;
		place(this.el, this.x + shake, lerp(H + 105 * this.s, H - 18 * this.s, ease.out(this.rise)), this.rot, this.s);
		return true;
	}
	hit(x, y) {
		this.alive = false; this.hitT = this.t;
		this.el.classList.add('dead');
		this.after = chance(.55) ? 'wave' : 'flag';
		noteKill(this);
		word(pick(['OUCH!', 'OOF!', 'HEY!']), x, y - 24, '#a3e635');
		sfx('ouch');
	}
	startle() { if (this.alive) this.life = Math.min(this.life, this.t); }
	cleanup() { this.mound.remove(); }
}

/* ------------------------------------------------------------------------------------------------ the centipede */

addDefs(`<radialGradient id="tth-centi" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#b8653d"/><stop offset=".55" stop-color="#5e2715"/><stop offset="1" stop-color="#220c05"/></radialGradient>`);
addCSS(`
.cp svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.cp .lg{fill:none;stroke:#8c5a3f;stroke-width:1.1;stroke-linecap:round}
:host([data-theme=light]) .cp .lg{stroke:#3a1a0c}
`);
function segSVG(i, n) {
	if (i === 0) return '<g class="ant"><path d="M4-2Q12-8 18-6M4 2Q12 8 18 6" stroke="#2a1006" stroke-width="1" fill="none" stroke-linecap="round"/></g>'
		+ '<path d="M5-2Q9-3.6 8.6 0M5 2Q9 3.6 8.6 0" stroke="#1a0803" stroke-width="1.3" fill="none"/>'
		+ '<ellipse class="rim" rx="6" ry="4.6" fill="url(#tth-centi)"/><circle cx="2.8" cy="-2.2" r=".9" fill="#000"/><circle cx="2.8" cy="2.2" r=".9" fill="#000"/>'
		+ '<circle class="hit" r="11" fill="transparent"/>';
	return '<path class="lg" d="M0-3L-2-10.5"/><path class="lg" d="M0 3L-2 10.5"/><ellipse class="rim" rx="4.8" ry="3.9" fill="url(#tth-centi)"/>'
		+ (i === n - 1 ? '<path d="M-4-1.5L-11-4.5M-4 1.5L-11 4.5" stroke="#2a1006" stroke-width="1.1" stroke-linecap="round"/>' : '')
		+ '<circle class="hit" r="9" fill="transparent"/>';
}
// Slithers in from an edge, its legs rippling in a wave down the body, and veers away from the mouse. Hit it near
// the head and it curls up; hit it further back and it comes apart, the tail half growing a head and crawling off
// the other way.
class Centipede {
	constructor(o) {
		o = o || {};
		this.kind = 'centipede'; this.alive = true; this.scareable = false; this.t = 0; this.dist = 0;
		this.s = o.s || rand(.95, 1.2) * fit(.8);
		this.gap = 7.4 * this.s;
		if (o.segs) { this.segs = o.segs; this.h = o.segs[0].a; this.route(o.segs[0]); }
		else {
			const n = irand(14, 19), r = crawlRoute();
			this.wps = r.points; this.wi = 0;
			this.h = Math.atan2(this.wps[0].y - r.start.y, this.wps[0].x - r.start.x);
			this.segs = [];
			for (let i = 0; i < n; i++) this.segs.push({ x: r.start.x - Math.cos(this.h) * this.gap * i, y: r.start.y - Math.sin(this.h) * this.gap * i, a: this.h });
		}
		this.speed = o.speed || rand(70, 110); this.p = rand(0, TAU);
		this.el = doc.createElement('div');
		this.el.className = 'c cp';
		this.el.style.transform = 'none';
		this.el.style.width = this.el.style.height = '100%';
		let g = '';
		for (let i = this.segs.length - 1; i >= 0; i--) g += '<g class="sg" data-i="' + i + '">' + segSVG(i, this.segs.length) + '</g>';
		this.el.innerHTML = '<svg>' + g + '</svg>';
		stage.appendChild(this.el);
		this.g = []; this.legs = [];
		for (const e of this.el.querySelectorAll('.sg')) { const i = +e.dataset.i; this.g[i] = e; this.legs[i] = e.querySelectorAll('.lg'); }
		this.ant = this.el.querySelector('.ant');
		this.draw();
		enlist(this);
	}
	route(from) {   // a cut-off half: out by the nearest edge ahead of it
		const ex = from.x + Math.cos(from.a) * 2000, ey = from.y + Math.sin(from.a) * 2000;
		this.wps = [{ x: clamp(ex, -90, W + 90), y: clamp(ey, -90, H + 90) }]; this.wi = 0;
	}
	update(dt) {
		this.t += dt;
		if (!this.alive) return this.dying(dt);
		const head = this.segs[0], wp = this.wps[this.wi];
		if (hypot(wp.x - head.x, wp.y - head.y) < 30 && this.wi < this.wps.length - 1) this.wi++;
		let aim = Math.atan2(wp.y - head.y, wp.x - head.x) + .55 * Math.sin(this.t * 2.2 + this.p) + .25 * Math.sin(this.t * 4.1);
		if (pointerNear(head.x, head.y, 120)) aim = Math.atan2(head.y - P.y, head.x - P.x);
		this.h += clamp(angDiff(this.h, aim), -2.8 * dt, 2.8 * dt);
		head.x += Math.cos(this.h) * this.speed * dt; head.y += Math.sin(this.h) * this.speed * dt; head.a = this.h;
		this.dist += this.speed * dt;
		for (let i = 1; i < this.segs.length; i++) {
			const p = this.segs[i - 1], q = this.segs[i], dx = p.x - q.x, dy = p.y - q.y, d = hypot(dx, dy) || 1;
			if (d > this.gap) { q.x = p.x - dx / d * this.gap; q.y = p.y - dy / d * this.gap; }
			q.a = Math.atan2(dy, dx);
		}
		this.draw();
		if (this.segs.some(q => onScreen(q.x, q.y, 10))) this.entered = true;
		const gone = this.wi === this.wps.length - 1 && !this.segs.some(q => onScreen(q.x, q.y, 40));
		return !((this.entered || this.t > 8) && gone) && this.t < 80;
	}
	draw(still) {
		const n = this.segs.length;
		for (let i = 0; i < n; i++) {
			const q = this.segs[i];
			this.g[i].setAttribute('transform', 'translate(' + n1(q.x) + ' ' + n1(q.y) + ') rotate(' + n1(q.a * DEG) + ') scale(' + this.s.toFixed(2) + ')');
			if (i && !still) {
				const w = Math.sin(this.dist * .3 - i * .9) * 34;
				this.legs[i][0].setAttribute('transform', 'rotate(' + n1(w) + ' 0 -3)');
				this.legs[i][1].setAttribute('transform', 'rotate(' + n1(-w) + ' 0 3)');
			}
		}
		if (this.ant) this.ant.setAttribute('transform', 'rotate(' + n1(Math.sin(this.t * 7) * 8) + ' 4 0)');
	}
	hit(x, y) {
		let k = 0, best = 1e9;
		this.segs.forEach((q, i) => { const d = hypot(q.x - x, q.y - y); if (d < best) { best = d; k = i; } });
		noteKill(this);
		if (k >= 3 && this.segs.length - k >= 4) {   // cut in two
			const front = this.segs.slice(0, k), back = this.segs.slice(k).reverse();
			back.forEach(q => { q.a += Math.PI; });
			splat(x, y, 7, GOO.green, this.el, 1600);
			word(pick(['SNIP!', 'CHOP!']), x, y - 18);
			sfx('snip');
			this.alive = false; this.how = 'split';
			new Centipede({ segs: front, s: this.s, speed: this.speed * 1.25 }).wps = this.wps.slice(this.wi);
			new Centipede({ segs: back, s: this.s, speed: this.speed * 1.4 });
			return;
		}
		// curls up into a coil
		this.alive = false; this.how = 'curl'; this.dt = 0;
		this.el.classList.add('dead');
		this.from = this.segs.map(q => ({ x: q.x, y: q.y, a: q.a }));
		word(pick(['CRUNCH!', 'GOTCHA!']), x, y - 18);
		sfx('crunch');
	}
	dying(dt) {
		if (this.how === 'split') return false;
		const t = this.dt += dt, k = ease.out(Math.min(1, t / .7)), c = this.from[0];
		this.segs.forEach((q, i) => {
			const th = this.h + Math.PI + i * .62, r = this.gap * (.55 + i * .2);
			q.x = lerp(this.from[i].x, c.x + Math.cos(th) * r, k);
			q.y = lerp(this.from[i].y, c.y + Math.sin(th) * r, k);
			q.a = lerp(this.from[i].a, th + Math.PI / 2, k);
		});
		this.draw(true);
		if (t > 1.6) this.el.style.opacity = Math.max(0, 1 - (t - 1.6) / .6);
		return t < 2.2;
	}
	startle() { if (this.alive) { this.speed = 230; this.route(this.segs[0]); } }
}

/* ------------------------------------------------------------------------------------------------ the black cat */

addCSS(`
.cat .fur{fill:#0b0a0e}
.cat .far{fill:#050407;stroke:#050407}
.cat .lgp{fill:none;stroke:#0b0a0e;stroke-linecap:round}
.cat .tail{fill:none;stroke:#0b0a0e;stroke-linecap:round}
.cat .rimline{fill:none;stroke:var(--rim);stroke-width:.9}
.cat.ghostly{opacity:.5}
.cat.ghostly .fur,.cat.ghostly .far{fill:#e8edff}
.cat.ghostly .lgp,.cat.ghostly .tail{stroke:#e8edff}
`);
const catLeg = (cls, x, y, a, b) => '<g class="lg ' + cls + '" transform="translate(' + x + ' ' + y + ')"><path class="lgp" d="M0 0L0 ' + a + '" stroke-width="7"/>'
	+ '<g class="kn" transform="translate(0 ' + a + ')"><path class="lgp" d="M0 0L0 ' + b + '" stroke-width="4.8"/><ellipse class="fur" cx="1.8" cy="' + b + '" rx="3.9" ry="2.2"/></g></g>';
function catSVG() {
	return '<g transform="translate(0 30)">'
		+ '<ellipse cx="0" cy="1" rx="44" ry="4" fill="url(#tth-shadow)" opacity=".6"/>'
		+ '<path class="tail" stroke-width="5.4"/>'
		+ catLeg('far fb', -23, -31, 15, 15) + catLeg('far ff', 17, -28, 13, 14)
		+ '<path class="fur body"/><path class="rimline bodyrim"/>'
		+ catLeg('nb', -27, -31, 15, 15) + catLeg('nf', 21, -28, 13, 14)
		+ '<g class="head side" transform="translate(37 -53)">'
		+ '<path class="fur" d="M-6-6L-5-17L1-9ZM2-9L8-18L10-6Z"/><path class="fur" d="M-9 1C-10-7-3-11 3-10.5C9-10 12-5 12.5 0C13.5 3.5 11 6 6 6.5C1 7-6 6-9 1Z"/>'
		+ '<path class="rimline" d="M-9 1C-10-7-3-11 3-10.5C9-10 12-5 12.5 0M-5-17L1-9M8-18L10-6"/>'
		+ '<path d="M2-2.5Q5-5.5 8-2.5Q5 0 2-2.5Z" fill="#b8ff4d"/><ellipse cx="5.3" cy="-2.5" rx=".7" ry="1.9" fill="#0b1400"/>'
		+ '<path class="mouth" d="M9 3.4Q11.4 6.4 13.6 3.4" fill="#5a1220" opacity="0"/>'
		+ '<path d="M11 1.6L19.5-.4M11 2.8L19.5 3.8" stroke="rgba(255,255,255,.35)" stroke-width=".5"/></g>'
		+ '<g class="head front" transform="translate(37 -53)" opacity="0">'
		+ '<path class="fur" d="M-11-5L-9-18L-2-10ZM2-10L9-18L11-5Z"/><circle class="fur" r="11"/><path class="rimline" d="M-11 0A11 11 0 0 1 11 0"/>'
		+ '<g class="eyes"><path d="M-8.4-2Q-5-5.4-1.6-2Q-5 1-8.4-2Z" fill="#b8ff4d"/><path d="M1.6-2Q5-5.4 8.4-2Q5 1 1.6-2Z" fill="#b8ff4d"/>'
		+ '<ellipse cx="-5" cy="-2" rx=".7" ry="2.2" fill="#0b1400"/><ellipse cx="5" cy="-2" rx=".7" ry="2.2" fill="#0b1400"/></g>'
		+ '<path d="M-1.4 3h2.8L0 4.6Z" fill="#3a2a30"/><path d="M-6 3.5L-15 2M-6 5L-15 6M6 3.5L15 2M6 5L15 6" stroke="rgba(255,255,255,.35)" stroke-width=".5"/></g>'
		+ '<rect class="hit" x="-46" y="-84" width="102" height="84" rx="18" fill="transparent"/>'
		+ '</g>';
}
function catBody(k) {   // k: 0 walking, 1 back arched
	const top = lerp(-52, -76, k), mid = lerp(-50, -74, k), rump = lerp(-45, -49, k), belly = lerp(-25, -31, k);
	return 'M30 -46C22 ' + n1(top) + ' -10 ' + n1(mid) + ' -28 ' + n1(rump) + 'C-38 ' + n1(rump + 3) + ' -40 -33 -34 -27C-28 -22 -18 ' + n1(belly + 1)
		+ ' -10 ' + n1(belly) + 'C2 ' + n1(belly - 1) + ' 14 -25 22 -26C32 -28 36 -40 30 -46Z';
}
// the tail: an S up from the rump with a hook at the tip; straight up and bristling when the back is arched
const TAIL_WALK = [-34, -40, -50, -44, -56, -62, -48, -76, -44, -82, -38, -82, -37, -76];
const TAIL_ARCH = [-34, -42, -37, -54, -37, -66, -35, -78, -34, -84, -33, -90, -32, -96];
function catTail(k, sway) {
	const p = TAIL_WALK.map((v, i) => lerp(v, TAIL_ARCH[i], k) + (i % 2 === 0 && i >= 4 ? sway * i / 12 : 0));
	return 'M' + n1(p[0]) + ' ' + n1(p[1]) + 'C' + p.slice(2, 8).map(n1).join(' ') + 'C' + p.slice(8).map(n1).join(' ');
}
// Walks along the bottom of the screen, tail swaying; sometimes stops, turns its head and stares at you, blinking
// slowly. Too close and it arches its back, hisses and bolts. It cannot be killed: every hit costs it one of its
// nine lives (they are remembered), and the ninth turns it into a ghost cat.
class Cat {
	constructor() {
		this.kind = 'cat'; this.alive = true; this.scareable = true; this.t = 0; this.dist = 0; this.arch = 0; this.look = 0;
		this.s = rand(.95, 1.15) * fit(.75);
		this.el = creatureEl(130, 'cat', catSVG());
		const q = s => this.el.querySelector(s);
		this.bodyP = q('.body'); this.bodyRim = q('.bodyrim'); this.tail = q('.tail'); this.side = q('.side'); this.front = q('.front');
		this.mouth = q('.mouth'); this.eyes = q('.front .eyes');
		this.lg = ['.nf', '.nb', '.ff', '.fb'].map(s => ({ g: q(s), k: q(s + ' .kn'), x: q(s).getAttribute('transform'), kx: q(s + ' .kn').getAttribute('transform') }));
		this.dir = chance(.5) ? 1 : -1;
		this.x = this.dir > 0 ? -80 : W + 80;
		this.v = rand(70, 100); this.mode = 'walk';
		this.stopAt = chance(.55) ? rand(.3, .7) * W : -1;
		this.update(0);
		enlist(this);
	}
	update(dt) {
		this.t += dt;
		const t = this.t;
		if (this.ghost) return this.floating(dt);
		if (this.mode === 'walk' && this.alive && pointerNear(this.x, H - 40 * this.s, 140)) this.hiss();
		if (this.mode === 'walk' && this.stopAt >= 0 && (this.dir > 0 ? this.x > this.stopAt : this.x < this.stopAt)) { this.stopAt = -1; this.mode = 'stare'; this.modeT = rand(2.2, 3.4); }
		let speed = 0;
		if (this.mode === 'walk') speed = this.v;
		else if (this.mode === 'stare') { if ((this.modeT -= dt) <= 0) { this.mode = 'walk'; if (chance(.3)) this.dir = -this.dir; } }
		else if (this.mode === 'hiss') { if ((this.modeT -= dt) <= 0) { this.mode = 'run'; this.dir = this.x < W / 2 ? -1 : 1; } }
		else if (this.mode === 'run') speed = 400;
		this.x += this.dir * speed * dt;
		this.dist += speed * dt;
		this.arch += ((this.mode === 'hiss' ? 1 : 0) - this.arch) * Math.min(1, dt * 10 || 1);
		this.look += ((this.mode === 'stare' ? 1 : 0) - this.look) * Math.min(1, dt * 5 || 1);
		// legs: a trot, diagonal pairs together; straight and stiff when arched
		const ph = this.dist / 44 * TAU, sw = speed > 0 ? (this.mode === 'run' ? 38 : 26) : 0;
		const sets = [[0, 1], [Math.PI, -1], [Math.PI, 1], [0, -1]];   // near front, near back, far front, far back
		this.lg.forEach((L, i) => {
			const p = ph + sets[i][0], up = Math.sin(p) * sw * (1 - this.arch), knee = Math.max(0, Math.sin(p + Math.PI / 2)) * (speed > 0 ? 34 : 0) * sets[i][1];
			L.g.setAttribute('transform', L.x + ' rotate(' + n1(up) + ')');
			L.k.setAttribute('transform', L.kx + ' rotate(' + n1(knee * (1 - this.arch)) + ')');
		});
		const b = catBody(this.arch);
		this.bodyP.setAttribute('d', b);
		this.bodyRim.setAttribute('d', b.slice(0, b.indexOf('C-38')));
		this.tail.setAttribute('d', catTail(this.arch, Math.sin(t * 2.2) * 9 * (1 - this.arch)));
		this.tail.setAttribute('stroke-width', n1(lerp(5.4, 10, this.arch)));
		this.side.setAttribute('opacity', (1 - this.look).toFixed(2));
		this.front.setAttribute('opacity', this.look.toFixed(2));
		const blink = this.mode === 'stare' && (t % 2.4) > 2.05 ? .12 : 1;   // the slow blink
		this.eyes.setAttribute('transform', 'translate(0 -2) scale(1 ' + blink + ') translate(0 2)');
		this.mouth.setAttribute('opacity', this.arch > .5 ? 1 : 0);
		place(this.el, this.x, H - 30 * this.s + Math.abs(Math.sin(ph)) * -1.5, 0, this.s, this.dir);
		return this.t < 3 || onScreen(this.x, H / 2, 90);
	}
	hiss() {
		this.mode = 'hiss'; this.modeT = .9;
		this.dir = P.x < this.x ? -1 : 1;   // faces the trouble
		bubble('HSSSS!', this.x, H - 100 * this.s, 1100);
	}
	hit(x, y) {
		if (this.ghost || this.mode === 'run') return;
		noteKill(this);
		let lives = keep.get('cat', 9) - 1;
		if (lives <= 0) {
			keep.set('cat', 9);
			this.ghost = true; this.alive = false; this.t0 = this.t; this.y = H - 30 * this.s;
			this.el.classList.add('ghostly', 'dead');
			bubble('Meow... that was number nine.', this.x, H - 105 * this.s, 2600);
			sfx('wail');
			return;
		}
		keep.set('cat', lives);
		this.hiss();
		this.modeT = .7;
		bubble(lives === 1 ? 'Last life. Careful now.' : lives + ' lives left', this.x, H - 105 * this.s, 1800);
		sfx('hiss');
	}
	floating(dt) {   // the ghost cat drifts up and away
		const t = this.t - this.t0;
		this.y -= 55 * dt;
		this.el.style.opacity = Math.max(0, .55 - t / 5).toFixed(3);
		place(this.el, this.x + Math.sin(t * 2) * 14, this.y, Math.sin(t * 1.5) * .08, this.s, this.dir);
		return t < 2.8;
	}
	startle() { if (this.alive && this.mode !== 'run') { this.mode = 'run'; this.dir = this.x < W / 2 ? -1 : 1; } }
}

/* ------------------------------------------------------------------------------------------------ the skull */

addDefs(`<radialGradient id="tth-bone" cx=".42" cy=".35" r=".75"><stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#e2d8bd"/><stop offset="1" stop-color="#a9a084"/></radialGradient>`);
const SKULL_TOP = '<path class="rim" d="M-26-6C-28-42 28-42 26-6C26 6 20 12 16 15L-16 15C-20 12-26 6-26-6Z" fill="url(#tth-bone)"/>'
	+ '<path d="M6-31l3 6-4 5 3 6" fill="none" stroke="#6d6450" stroke-width=".9" stroke-linecap="round"/>'
	+ '<ellipse cx="-11" cy="-6" rx="8" ry="9" fill="#1a1410"/><ellipse cx="11" cy="-6" rx="8" ry="9" fill="#1a1410"/>'
	+ '<circle class="glint" cx="-10" cy="-5" r="2.2" fill="#ff3b2f"/><circle class="glint" cx="10" cy="-5" r="2.2" fill="#ff3b2f"/>'
	+ '<path d="M0 4L-3.4 10.5H3.4Z" fill="#1a1410"/>'
	+ '<g fill="#f6f0df" stroke="#8b836b" stroke-width=".6"><rect x="-12" y="13" width="4" height="6" rx="1.4"/><rect x="-8" y="13" width="4" height="6.5" rx="1.4"/>'
	+ '<rect x="-4" y="13" width="4" height="7" rx="1.4"/><rect x="0" y="13" width="4" height="7" rx="1.4"/><rect x="4" y="13" width="4" height="6.5" rx="1.4"/><rect x="8" y="13" width="4" height="6" rx="1.4"/></g>';
const SKULL_JAW = '<path class="rim" d="M-17 18C-18 32 18 32 17 18L13 21L-13 21Z" fill="url(#tth-bone)"/>'
	+ '<g fill="#f6f0df" stroke="#8b836b" stroke-width=".6"><rect x="-10" y="17" width="4" height="5" rx="1.4"/><rect x="-6" y="17" width="4" height="5.5" rx="1.4"/>'
	+ '<rect x="-2" y="17" width="4" height="5.5" rx="1.4"/><rect x="2" y="17" width="4" height="5.5" rx="1.4"/><rect x="6" y="17" width="4" height="5" rx="1.4"/></g>';
const BONE = '<path d="M-14-3.2a3.6 3.6 0 1 1 0-1.2h28a3.6 3.6 0 1 1 0 1.2a3.6 3.6 0 1 1 0 6.4h-28a3.6 3.6 0 1 1 0-6.4Z" fill="url(#tth-bone)" stroke="#8b836b" stroke-width=".7"/>';
function skullSVG() {
	// four bony fingers hooked over the edge of the screen (which is at x = -22 here, once it has peeked out)
	let fingers = '';
	for (let i = 0; i < 4; i++) {
		const y = -54 + i * 5.3, d = 'M-42 ' + n1(y + 1) + 'L-20 ' + n1(y - 1.4) + 'Q-15 ' + n1(y - 1.8) + ' -14.4 ' + n1(y + 2.6) + 'L-15.2 ' + n1(y + 5.6);
		fingers += '<path d="' + d + '" stroke="#8b836b" stroke-width="4.9"/><path d="' + d + '" stroke="#efe7d2" stroke-width="3.1"/>'
			+ '<circle cx="-20" cy="' + n1(y - 1.4) + '" r="2.2" fill="#f4eddb" stroke="#8b836b" stroke-width=".6"/>';
	}
	return '<g class="hand" fill="none" stroke-linecap="round" stroke-linejoin="round">' + fingers + '</g><g class="skull">' + SKULL_TOP + '<g class="jaw">' + SKULL_JAW + '</g></g>'
		+ '<ellipse class="hit" rx="30" ry="34" fill="transparent"/>';
}
// Peeks round the edge of the screen, bony fingers curled over the edge, tilts its head, chatters with laughter and
// watches the mouse; ducks back out if the mouse comes near. Hit it and it falls to pieces.
class Skull {
	constructor() {
		this.kind = 'skull'; this.alive = true; this.scareable = true; this.t = 0;
		this.s = rand(1, 1.25) * fit(.8);
		this.el = creatureEl(120, 'sk', skullSVG());
		this.skull = this.el.querySelector('.skull'); this.jaw = this.el.querySelector('.jaw');
		this.dir = chance(.5) ? 1 : -1;   // 1: from the left edge
		this.y = rand(.2, .75) * H; this.peek = 0; this.life = rand(4.5, 7); this.chatter = 0; this.tilt = 0;
		this.update(0);
		enlist(this);
	}
	update(dt) {
		this.t += dt;
		const t = this.t;
		if (!this.alive) return false;
		if (!this.leaving && (t > this.life || (t > .8 && pointerNear(this.x, this.y, 110)))) this.leaving = t;
		this.peek = this.leaving ? Math.max(0, 1 - (t - this.leaving) / .35) : Math.min(1, t / .6);
		if (this.leaving && this.peek <= 0) return false;
		if (t > 1.2 && t < 2.6 && !this.laughed) { this.laughed = true; word(pick(['HEHEHE', 'HA HA HA', 'HEH']), this.x + this.dir * 40, this.y - 46, '#f3ead2', 20); }
		this.chatter = t > 1.2 && t < 2.4 ? Math.abs(Math.sin(t * 22)) : 0;
		const look = P.on ? clamp((P.y - this.y) / 300, -.4, .4) : Math.sin(t * 1.4) * .2;
		this.tilt += ((.22 + look) - this.tilt) * Math.min(1, dt * 4 || 1);
		this.jaw.setAttribute('transform', 'translate(0 ' + n1(this.chatter * 4) + ')');
		this.x = this.dir > 0 ? lerp(-45, 22, ease.out(this.peek)) * this.s : W - lerp(-45, 22, ease.out(this.peek)) * this.s;
		place(this.el, this.x, this.y, this.tilt * this.dir, this.s, this.dir);
		return true;
	}
	hit(x, y) {   // falls apart: cranium, jaw and a few bones tumble down
		this.alive = false;
		noteKill(this);
		word(pick(['CLATTER!', 'BONK!', 'RATTLE!']), x, y - 30, '#f3ead2');
		sfx('clatter');
		const parts = [[SKULL_TOP, 0, -4], [SKULL_JAW, 0, 18], [BONE, -6, 30], [BONE, 8, 34], [BONE, 0, 38]];
		parts.forEach(([m, ox, oy], i) => {
			const b = svgBit('<g transform="scale(' + this.s.toFixed(2) + ')">' + m + '</g>', 80, 80, stage);
			particle(b, this.x + ox * this.s * this.dir, this.y + oy * this.s, { vx: rand(-120, 120) + this.dir * 60, vy: rand(-320, -120) - i * 20, g: 1500, vr: rand(-400, 400), life: 1.6, fade: .75 });
		});
	}
	startle() { if (this.alive && !this.leaving) this.leaving = this.t; }
}

/* ------------------------------------------------------------------------------------------------ the jack-o'-lantern */

addDefs(`
<radialGradient id="tth-pk" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffb757"/><stop offset=".55" stop-color="#f07316"/><stop offset="1" stop-color="#9a3a07"/></radialGradient>
<radialGradient id="tth-pkface" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#fff6c0"/><stop offset=".5" stop-color="#ffc400"/><stop offset="1" stop-color="#ff6a00"/></radialGradient>
`);
const PUMPKIN_FACE = '<path d="M-16-3L-8-14L-2-3ZM2-3L8-14L16-3Z"/><path d="M-2.4 1L0-3L2.4 1Z"/>'
	+ '<path class="mouthp" d="M-18 6L-13 10L-10 7L-6 11L-2 7L2 11L6 7L10 11L13 7L18 6C14 18-14 18-18 6Z"/>';
function pumpkinSVG() {
	return '<ellipse cy="26" rx="30" ry="5" fill="url(#tth-shadow)" opacity=".6"/>'
		+ '<g class="roll"><circle class="halo" cy="2" r="40" fill="url(#tth-goldglow)" opacity="0"/>'
		+ '<g stroke="#7a2e05" stroke-width=".8"><ellipse cx="-22" cy="2" rx="12" ry="22" fill="url(#tth-pk)"/><ellipse cx="22" cy="2" rx="12" ry="22" fill="url(#tth-pk)"/>'
		+ '<ellipse cx="-12" cy="2" rx="13.5" ry="24.5" fill="url(#tth-pk)"/><ellipse cx="12" cy="2" rx="13.5" ry="24.5" fill="url(#tth-pk)"/>'
		+ '<ellipse cy="2" rx="13.5" ry="26" fill="url(#tth-pk)"/></g>'
		+ '<path d="M-3-22C-4-30 2-35 7-34L8-31C3-31 3-26 4-22Z" fill="#4d6b2a" stroke="#2c3f16" stroke-width=".8"/>'
		+ '<g class="face" fill="url(#tth-pkface)">' + PUMPKIN_FACE + '</g></g>'
		+ '<circle class="hit" cy="2" r="30" fill="transparent"/>';
}
// Rolls in along the bottom of the screen, wakes up with a flicker, hops after the mouse and snaps at it, then rolls
// off. Hit it and it bursts (or its candle goes out and it rolls away sulking).
class Pumpkin {
	constructor() {
		this.kind = 'pumpkin'; this.alive = true; this.scareable = true; this.t = 0;
		this.s = rand(.95, 1.15) * fit(.8);
		this.el = creatureEl(100, 'pk', pumpkinSVG());
		this.rollG = this.el.querySelector('.roll'); this.face = this.el.querySelector('.face'); this.halo = this.el.querySelector('.halo'); this.mouthP = this.el.querySelector('.mouthp');
		this.dir = chance(.5) ? 1 : -1;
		this.x = this.dir > 0 ? -60 : W + 60; this.stopX = rand(.25, .75) * W; this.y = 0; this.vy = 0; this.rot = 0;
		this.mode = 'in'; this.lit = 0; this.flick = 1; this.life = rand(5, 8); this.chomp = 0;
		this.update(0);
		enlist(this);
	}
	update(dt) {
		this.t += dt;
		let vx = 0;
		if (this.mode === 'in') { vx = this.dir * 170; if (this.dir > 0 ? this.x >= this.stopX : this.x <= this.stopX) { this.mode = 'awake'; this.modeT = this.t; } }
		else if (this.mode === 'awake') {
			this.lit = Math.min(1, this.lit + dt * 1.6);
			// hops towards the mouse from a distance; once the mouse is right there it stays put and snaps at it
			if (this.y === 0 && this.t - this.modeT > 1 && pointerNear(this.x, H - 60, 260) && !pointerNear(this.x, H - 40, 95) && Math.random() < dt * 2.5) { this.vy = -330; this.hopDir = Math.sign(P.x - this.x); }
			if (this.t - this.modeT > this.life) { this.mode = 'out'; this.dir = this.x < W / 2 ? -1 : 1; }
		} else if (this.mode === 'out' || this.mode === 'sulk') vx = this.dir * (this.mode === 'sulk' ? 70 : 190);
		if (this.vy || this.y < 0) {   // a hop
			this.vy += 1300 * dt; this.y += this.vy * dt; vx += (this.hopDir || 0) * 120;
			if (this.y >= 0) { this.y = 0; this.vy = 0; }
		}
		this.x += vx * dt;
		this.rot += vx * dt / (26 * this.s);
		this.chomp = this.alive && pointerNear(this.x, H - 40, 85) ? Math.abs(Math.sin(this.t * 12)) : 0;
		// candle flicker
		if (Math.random() < dt * 14) this.flick = rand(.65, 1);
		const glow = this.lit * this.flick;
		this.face.setAttribute('opacity', this.mode === 'sulk' ? 0 : (.25 + .75 * glow).toFixed(2));
		this.halo.setAttribute('opacity', (glow * .7).toFixed(2));
		this.mouthP.setAttribute('transform', 'translate(0 6) scale(1 ' + (1 + this.chomp * .8).toFixed(2) + ') translate(0 -6)');
		this.rollG.setAttribute('transform', 'rotate(' + n1(this.mode === 'awake' ? Math.sin(this.t * 3) * 6 : this.rot * DEG) + ')');
		place(this.el, this.x, H - 28 * this.s + this.y, 0, this.s);
		return this.alive || this.mode === 'sulk' ? this.t < 3 || onScreen(this.x, H / 2, 70) : false;
	}
	hit(x, y) {
		noteKill(this);
		if (chance(.35)) {   // the candle goes out; it rolls off sulking
			this.mode = 'sulk'; this.alive = false; this.dir = this.x < W / 2 ? -1 : 1;
			this.el.classList.add('dead');
			smoke(this.x, H - 50 * this.s, 4, .5);
			word('PFFT!', x, y - 30, '#ffb347');
			sfx('poof');
			return;
		}
		this.alive = false;   // smashed: shell, seeds, a puff
		word(pick(['SMASH!', 'SPLAT!', 'KA-BOOM!']), x, y - 30);
		sfx('smash');
		const cx = this.x, cy = H - 28 * this.s;
		for (let i = 0; i < 8; i++) {
			const a = rand(0, TAU), r = rand(7, 13), shard = svgBit('<path d="' + blobPath(r, 5, .45) + '" fill="url(#tth-pk)" stroke="#7a2e05" stroke-width=".8"/>', 40, 40, stage);
			particle(shard, cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, { vx: Math.cos(a) * rand(120, 300), vy: Math.sin(a) * 200 - 260, g: 1300, vr: rand(-500, 500), life: 1.3, fade: .7, s: this.s });
		}
		for (let i = 0; i < 12; i++) {
			const seed = svgBit('<ellipse rx="2.6" ry="1.6" fill="#f6ecd0" stroke="#b9a77a" stroke-width=".5"/>', 10, 10, stage);
			particle(seed, cx, cy, { vx: rand(-260, 260), vy: rand(-420, -160), g: 1400, vr: rand(-700, 700), life: 1.2, fade: .7 });
		}
		smoke(cx, cy - 10, 6, .8);
	}
}

/* ------------------------------------------------------------------------------------------------ the witch (rare) */

addDefs(`
<radialGradient id="tth-moon" cx=".42" cy=".38" r=".62"><stop offset="0" stop-color="#fffdf0"/><stop offset=".6" stop-color="#f7e9b5"/><stop offset="1" stop-color="#dcc684"/></radialGradient>
<radialGradient id="tth-moonglow"><stop offset=".5" stop-color="#fff3c4" stop-opacity=".45"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>
`);
addDefs(`<radialGradient id="tth-wglow"><stop offset="0" stop-color="#a78bfa" stop-opacity=".32"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></radialGradient>`);
addCSS(`.wt .sil{fill:#170f22} :host([data-theme=light]) .wt .wglow{display:none}`);
function witchSVG() {
	return '<ellipse class="wglow" cx="-6" cy="-20" rx="70" ry="46" fill="url(#tth-wglow)"/><g class="cape-g"><path class="sil cape"/></g>'
		+ '<path d="M-58 4L-86-7L-81 3L-90 9L-80 12L-86 21L-58 9Z" fill="#b08a4a" stroke="#6e5226" stroke-width=".8"/>'
		+ '<path d="M-60 6L-84-2M-60 7L-86 10M-60 8L-82 18" stroke="#6e5226" stroke-width=".8"/>'
		+ '<path d="M-58 6L46-6" stroke="#5a3a22" stroke-width="3.4" stroke-linecap="round"/><rect x="-62" y="2" width="6" height="7" rx="1.5" fill="#7c3aed" transform="rotate(-6 -59 5)"/>'
		+ '<g class="sil"><path d="M0-28C-6-20-9-8-8 2L14 2C15-8 13-20 8-28Z"/><path d="M-10 2C-14 10-10 16-2 14L18 10C16 6 15 3 14 1Z"/>'
		+ '<path d="M10 6L20 14L27 12L28 16L18 18Z"/><circle cx="6" cy="-34" r="6.2"/><path d="M11-36L20-31L11-31Z"/></g>'
		+ '<path d="M8-22C14-16 19-10 23-4" stroke="#170f22" stroke-width="4.2" stroke-linecap="round" fill="none"/><circle cx="24" cy="-4" r="2.6" fill="#170f22"/>'
		+ '<path d="M0-36C-6-34-11-28-15-23M1-33C-4-30-8-24-11-19" stroke="#170f22" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
		+ '<g class="hat"><ellipse cx="5" cy="-40" rx="13" ry="2.8" class="sil" transform="rotate(-8 5 -40)"/>'
		+ '<path class="sil" d="M-3-41C-1-50-5-58-15-65C-6-57 4-51 13-42Z"/><path d="M-3-43.5L12-44" stroke="#7c3aed" stroke-width="2.4"/></g>'
		+ '<circle cx="8.6" cy="-35" r=".9" fill="#9dff4a"/>'
		+ '<rect class="hit" x="-70" y="-60" width="120" height="80" rx="20" fill="transparent"/>';
}
// A rare one: a full moon rises at the top of the screen and a witch on her broom crosses it, sometimes looping the
// loop, trailing sparks. Hit her and she spins, loses her hat and a shower of sweets, cackles and makes off.
class Witch {
	constructor() {
		this.kind = 'witch'; this.alive = true; this.scareable = false; this.t = 0;
		this.s = rand(1, 1.2) * fit(.7);
		this.dir = chance(.5) ? 1 : -1;
		const R = Math.round(clamp(Math.min(W, H) * .14, 60, 120));
		this.mx = this.dir > 0 ? rand(.45, .75) * W : rand(.25, .55) * W; this.my = clamp(rand(.12, .25) * H, R + 10, H / 2);
		this.moon = svgBit('<circle r="' + R * 1.9 + '" fill="url(#tth-moonglow)"/><circle r="' + R + '" fill="url(#tth-moon)"/>'
			+ '<g fill="#cdb878" opacity=".35"><circle cx="' + n1(-R * .3) + '" cy="' + n1(-R * .2) + '" r="' + n1(R * .14) + '"/><circle cx="' + n1(R * .25) + '" cy="' + n1(R * .3) + '" r="' + n1(R * .2) + '"/>'
			+ '<circle cx="' + n1(R * .35) + '" cy="' + n1(-R * .35) + '" r="' + n1(R * .09) + '"/><circle cx="' + n1(-R * .4) + '" cy="' + n1(R * .35) + '" r="' + n1(R * .08) + '"/></g>', R * 4, R * 4, stage);
		this.moon.style.transform = 'translate3d(' + n1(this.mx) + 'px,' + n1(this.my) + 'px,0)';
		this.moon.animate([{ opacity: 0, transform: 'translate3d(' + n1(this.mx) + 'px,' + n1(this.my + 30) + 'px,0) scale(.9)' }, { opacity: 1, transform: 'translate3d(' + n1(this.mx) + 'px,' + n1(this.my) + 'px,0) scale(1)' }],
			{ duration: 1400, easing: 'ease-out', fill: 'forwards' });
		this.el = creatureEl(200, 'wt', witchSVG());
		this.cape = this.el.querySelector('.cape'); this.hat = this.el.querySelector('.hat');
		this.x = this.bx = this.dir > 0 ? -120 : W + 120; this.y = this.y0 = this.my + rand(-15, 25); this.v = rand(200, 250);
		this.loop = chance(.4) ? 0 : -1; this.spin = 0;
		this.update(0);
		enlist(this);
	}
	update(dt) {
		const t = this.t += dt;
		if (t < 1) return this.draw(t, 0), true;   // the moon comes up first
		let a = 0, ox = 0, oy = 0;
		// the loop-the-loop: up, over backwards, down, round a circle that starts on her line
		if (this.loop === 0 && (this.dir > 0 ? this.bx > this.mx - 60 : this.bx < this.mx + 60)) this.loop = .001;
		const looping = this.loop > 0 && this.loop < 1;
		this.bx += this.dir * this.v * dt * (looping ? .25 : 1);
		if (looping) {
			this.loop = Math.min(1, this.loop + dt / 1.5);
			const th = ease.inOut(this.loop) * TAU, R = 62 * this.s;
			ox = this.dir * R * Math.sin(th); oy = -R * (1 - Math.cos(th));
			a = -th * this.dir;
		}
		if (this.spin > 0) { this.spin = Math.max(0, this.spin - dt); a += (1 - this.spin / .9) * TAU * 2 * this.dir; }
		this.x = this.bx + ox;
		this.y = this.y0 + Math.sin(t * 1.6) * 16 + oy;
		if (Math.random() < dt * 22) {
			const c = Math.cos(a), s = Math.sin(a), lx = -84 * this.s * this.dir, ly = 8 * this.s;
			sparkle(this.x + lx * c - ly * s, this.y + lx * s + ly * c, pick(['#ffd166', '#c084fc', '#fef3c7']), rand(.6, 1), { vx: -this.dir * rand(20, 60), vy: rand(10, 50), life: rand(.6, 1.1) });
		}
		this.draw(t, a);
		const gone = !onScreen(this.x, this.y, 130);
		if (gone && t > 3 && !this.moonOut) { this.moonOut = true; this.moon.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1200, fill: 'forwards' }).onfinish = () => this.moon.remove(); }
		return !(gone && t > 3);
	}
	draw(t, a) {
		const w = Math.sin(t * 9) * 4, w2 = Math.sin(t * 9 + 1.5) * 5;
		this.cape.setAttribute('d', 'M2-26C-12-24-28-16-42 ' + n1(-8 + w) + 'C-32 ' + n1(-3 + w2) + '-20 0-8 2Z');
		place(this.el, this.x, this.y, a, this.s, this.dir);
	}
	hit(x, y) {
		if (this.hitOnce) return;
		this.hitOnce = true; this.spin = .9; this.v *= 1.9;
		this.el.classList.add('dead');
		noteKill(this);
		word(pick(['WHOA!', 'HEY!', 'CURSES!']), x, y - 40, '#c084fc');
		sfx('cackle');
		this.hat.setAttribute('opacity', 0);
		const hat = svgBit('<g transform="scale(' + this.s.toFixed(2) + ')"><ellipse cx="5" cy="-40" rx="13" ry="2.8" fill="#170f22"/><path d="M-3-41C-1-50-5-58-15-65C-6-57 4-51 13-42Z" fill="#170f22"/><path d="M-3-43.5L12-44" stroke="#7c3aed" stroke-width="2.4"/></g>', 80, 120, stage);
		particle(hat, this.x, this.y + 30 * this.s, { vx: -this.dir * 40, vy: -60, g: 420, vr: rand(-160, 160), life: 2.4, fade: .8, drag: .6 });
		for (let i = 0; i < 9; i++) {
			const c = pick(['#ff8a1f', '#a855f7', '#22c55e', '#facc15']);
			const candy = svgBit('<path d="M-9-4L-5 0-9 4ZM9-4L5 0 9 4Z" fill="' + c + '" opacity=".85"/><ellipse rx="5.4" ry="4" fill="' + c + '"/><path d="M-3-2.4Q0 0-3 2.4M0-3Q3 0 0 3" stroke="#fff" stroke-opacity=".6" fill="none" stroke-width=".8"/>', 24, 12, stage);
			particle(candy, this.x + rand(-20, 20), this.y, { vx: rand(-160, 160), vy: rand(-260, -60), g: 900, vr: rand(-500, 500), life: 1.8, fade: .75 });
		}
	}
	cleanup() { if (!this.moonOut) this.moon.remove(); }
}

/* ------------------------------------------------------------------------------------------------ jump scares */

// Now and then a hit does not banish the creature: it leaps at the viewer instead, filling the screen (see
// scareNow for how often). The big faces are drawn in a 200 x 200 box scaled to the screen.
addDefs(`
<radialGradient id="tth-shead" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#46323d"/><stop offset=".6" stop-color="#160c12"/><stop offset="1" stop-color="#050305"/></radialGradient>
<radialGradient id="tth-seye" cx=".5" cy=".62" r=".62"><stop offset="0" stop-color="#7a1420"/><stop offset=".45" stop-color="#2a060b"/><stop offset="1" stop-color="#030102"/></radialGradient>
<radialGradient id="tth-maw" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#2a0508"/><stop offset="1" stop-color="#000"/></radialGradient>
`);
addCSS(`
.veil{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.2) 0%,rgba(0,0,0,.62) 62%,rgba(0,0,0,.9) 100%)}
.sbox{position:absolute;left:0;top:0;will-change:transform,opacity}
.sbox>div{width:100%;height:100%}
.sbox svg{width:100%;height:100%;display:block;overflow:visible}
.sbox .rim{stroke:none}
`);

function spiderFace() {
	let hair = '';
	for (let i = 0; i < 160; i++) {
		const a = rand(-Math.PI, Math.PI), r0 = rand(47, 55), r1 = r0 + rand(5, 15), b = a + rand(-.12, .12);
		hair += 'M' + n1(Math.cos(a) * r0 * 1.1) + ' ' + n1(Math.sin(a) * r0 - 4) + 'L' + n1(Math.cos(b) * r1 * 1.1) + ' ' + n1(Math.sin(b) * r1 - 4);
	}
	const leg = d => '<path d="' + d + '" stroke="#150c11" stroke-width="10" stroke-linecap="round" fill="none"/>'
		+ '<path d="' + d + '" stroke="#3d2832" stroke-width="15" stroke-dasharray="1 3.2" stroke-linecap="round" fill="none" opacity=".8"/>';
	let legs = '';
	for (const d of ['M-36-28Q-70-80-118-74', 'M-46-10Q-94-32-124 2', 'M-46 12Q-92 22-118 56', 'M-34 30Q-68 72-96 112']) legs += leg(d) + '<g transform="scale(-1,1)">' + leg(d) + '</g>';
	// glossy eyes with a dull red sheen deep inside and one hard glint each
	const eye = (x, y, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + n1(r * 1.12) + '" fill="#050203"/><circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#tth-seye)"/>'
		+ '<ellipse cx="' + n1(x - r * .38) + '" cy="' + n1(y - r * .42) + '" rx="' + n1(r * .2) + '" ry="' + n1(r * .14) + '" fill="#fff" opacity=".9" transform="rotate(-35 ' + n1(x - r * .38) + ' ' + n1(y - r * .42) + ')"/>'
		+ '<circle cx="' + n1(x + r * .3) + '" cy="' + n1(y - r * .5) + '" r="' + n1(r * .07) + '" fill="#fff" opacity=".6"/>';
	let eyes = '';
	for (const [x, y, r] of [[17, -12, 13], [37, -24, 7.5], [8, -33, 4.6], [25, -38, 4.2]]) eyes += eye(-x, y, r) + eye(x, y, r);
	return '<g class="legs">' + legs + '</g><path d="' + hair + '" stroke="#26171f" stroke-width="1.6" stroke-linecap="round"/>'
		+ '<ellipse cy="-4" rx="58" ry="52" fill="url(#tth-shead)"/>' + eyes
		+ '<ellipse cx="-14" cy="26" rx="13" ry="21" transform="rotate(10 -14 26)" fill="url(#tth-shead)"/><ellipse cx="14" cy="26" rx="13" ry="21" transform="rotate(-10 14 26)" fill="url(#tth-shead)"/>'
		+ '<g class="fangs"><path d="M-18 40C-21 53-13 63-4 70C-8 59-10 50-8 40Z" fill="#eadcc2"/><path d="M18 40C21 53 13 63 4 70C8 59 10 50 8 40Z" fill="#eadcc2"/>'
		+ '<ellipse class="drop" cx="-4.6" cy="72" rx="2.3" ry="3.1" fill="#9dff3a"/></g>';
}
function ghostScream() {
	return '<circle r="96" fill="url(#tth-gglow)"/><g transform="scale(2.5) translate(0 4)"><path class="gb" d="' + ghostPath(0, 0) + '" fill="url(#tth-ghost)" stroke="rgba(150,165,230,.5)" stroke-width=".6"/>'
		+ '<ellipse cx="-9.5" cy="-13" rx="5" ry="9" fill="#120d22"/><ellipse cx="9.5" cy="-13" rx="5" ry="9" fill="#120d22"/>'
		+ '<ellipse class="maw" cy="10" rx="8" ry="15" fill="url(#tth-maw)"/></g>';
}
function grinFace(color) {
	const [grad, glow] = EYE_COLORS[color];
	const q = (t, a, c, b) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;   // a point on a quadratic curve
	let teeth = '';
	for (let i = 0; i < 12; i++) {
		const t0 = i / 12, t1 = (i + 1) / 12, tm = (t0 + t1) / 2;
		teeth += 'M' + n1(q(t0, -48, 0, 48)) + ' ' + n1(q(t0, 12, 38, 12)) + 'L' + n1(q(tm, -48, 0, 48)) + ' ' + n1(q(tm, 12, 38, 12) + 8 - Math.abs(tm - .5) * 6) + 'L' + n1(q(t1, -48, 0, 48)) + ' ' + n1(q(t1, 12, 38, 12)) + 'Z';
		if (i > 0 && i < 11) teeth += 'M' + n1(q(t0, -48, 0, 48)) + ' ' + n1(q(t0, 12, 60, 12)) + 'L' + n1(q(tm, -48, 0, 48)) + ' ' + n1(q(tm, 12, 60, 12) - 7) + 'L' + n1(q(t1, -48, 0, 48)) + ' ' + n1(q(t1, 12, 60, 12)) + 'Z';
	}
	let eyes = '';
	for (const x of [-26, 26]) eyes += '<g transform="translate(' + x + ' -16) scale(2.4)"><circle r="17" fill="url(#' + glow + ')"/><path d="M-10 0Q0-7.5 10 0Q0 7.5-10 0Z" fill="url(#' + grad + ')"/><ellipse class="pupil" rx="1.5" ry="5.4" fill="#120800"/><circle cx="-3" cy="-2.2" r="1.1" fill="#fff" opacity=".85"/></g>';
	return '<ellipse rx="96" ry="80" fill="url(#tth-dark)"/>' + eyes + '<path d="M-50 10Q0 64 50 10Q0 40-50 10Z" fill="#050104"/><path d="' + teeth + '" fill="#f3efe2"/>';
}
function catFace() {
	return '<g transform="scale(4.4)"><path d="M-11-6L-9-19L-2-11ZM2-11L9-19L11-6Z" fill="#0b0a0e" transform="rotate(-8)"/><circle r="11.5" fill="#0b0a0e"/>'
		+ '<path d="M-8.8-2Q-5-6.4-1.2-2Q-5 1.6-8.8-2Z" fill="#c4ff52"/><path d="M1.2-2Q5-6.4 8.8-2Q5 1.6 1.2-2Z" fill="#c4ff52"/>'
		+ '<ellipse cx="-5" cy="-2.2" rx=".6" ry="2.6" fill="#0b1400"/><ellipse cx="5" cy="-2.2" rx=".6" ry="2.6" fill="#0b1400"/>'
		+ '<path class="maw" d="M-5.4 3.6Q0 13 5.4 3.6Q0 5.8-5.4 3.6Z" fill="#5a1220"/><path d="M-3.6 4.2L-2.8 7.6L-1.9 4.8ZM3.6 4.2L2.8 7.6L1.9 4.8Z" fill="#fff"/>'
		+ '<path d="M-6 3.5L-17 1.5M-6 5L-17 6.5M6 3.5L17 1.5M6 5L17 6.5" stroke="rgba(255,255,255,.4)" stroke-width=".4"/></g>'
		+ [-1, 1].map(s => '<g transform="translate(' + s * 62 + ' 72) scale(' + s * 3.2 + ' 3.2)"><ellipse rx="8.5" ry="6.5" fill="#0b0a0e"/>'
			+ '<path d="M-6-4l-3-6M-2-6l-1.4-7M2-6l1.4-7M6-4l3-6" stroke="#f4f1ea" stroke-width="1.3" stroke-linecap="round"/></g>').join('');
}
// per creature: the art, its sound, what it does while it fills the screen (live), and how it leaves
const SCARES = {
	spider: c => ({ art: spiderFace(), sound: 'scream', end: chance(.5) ? 'slide' : 'crack', live: (r, t) => { const f = r.querySelector('.fangs'); if (f) f.setAttribute('transform', 'translate(0 ' + n1(Math.abs(Math.sin(t * 18)) * 3) + ')'); } }),
	bat: c => ({ art: '<g transform="scale(2.9)">' + batSVG() + '<path d="M-2.6-6Q0-.4 2.6-6Z" fill="#5a0a10"/><path d="M-1.9-5.9l.55 2.3.55-2.2M.8-5.9l.55 2.2.55-2.3" fill="#fff"/></g>', sound: 'scream', end: 'through', live: (r, t) => {
		const a = Math.sin(t * 40) * 40 - 4, tr = 'rotate(' + n1(a) + ' -3 -4)';
		r.querySelectorAll('.wl,.wr').forEach(w => w.setAttribute('transform', tr));
	} }),
	ghost: c => ({ art: ghostScream(), sound: 'wail', also: 'scream', end: 'through', live: (r, t) => { const m = r.querySelector('.maw'); if (m) m.setAttribute('ry', n1(15 + Math.sin(t * 30) * 2)); } }),
	eyes: c => ({ art: grinFace(c.color || 'y'), sound: 'scream', end: 'through' }),
	hand: c => ({ art: '<g transform="scale(1.6) translate(0 55)">' + handSVG() + '</g>', sound: 'thud', end: 'print' }),   // palm in the middle, fingers spread over the screen
	skull: c => ({ art: '<circle r="70" fill="url(#tth-eyeglow)" opacity=".5"/><g transform="scale(2.7)">' + SKULL_TOP + '<g class="jaw">' + SKULL_JAW + '</g></g>', sound: 'scream', end: 'crack',
		live: (r, t) => { const j = r.querySelector('.jaw'); if (j) j.setAttribute('transform', 'translate(0 ' + n1(8 + Math.abs(Math.sin(t * 16)) * 6) + ')'); } }),
	pumpkin: c => ({ art: '<g transform="scale(2.8)">' + pumpkinSVG() + '</g>', sound: 'scream', end: 'through', live: (r, t) => {
		const m = r.querySelector('.mouthp'), h = r.querySelector('.halo'), f = r.querySelector('.face');
		if (m) m.setAttribute('transform', 'translate(0 6) scale(1 ' + n1(1.6 + Math.abs(Math.sin(t * 14)) * .8) + ') translate(0 -6)');
		if (h) h.setAttribute('opacity', n1(.7 + Math.random() * .3)); if (f) f.setAttribute('opacity', 1);
	} }),
	cat: c => ({ art: catFace(), sound: 'hiss', also: 'scream', end: 'claws' }),
};

let scaring = false, labScare = false;
function scareNow(c) {
	if (!c.scareable || scaring || !SCARES[c.kind]) return false;
	if (labScare) { labScare = false; labSync(); return true; }
	if (REDUCED) return false;
	if (keep.get('kills', 0) < 2) return false;   // the first hits always banish: that is how a visitor learns what a click does
	if (Date.now() - keep.get('scareAt', 0) < 150000) return false;   // at most one every two and a half minutes
	return keep.get('debt', 0) >= 9 || chance(HALLOWEEN ? .2 : .14);
}

function jumpScare(c, x, y) {
	const S = SCARES[c.kind](c);
	scaring = true;
	keep.set('scareAt', Date.now());
	keep.set('debt', 0);
	live.delete(c); c.el.remove(); c.cleanup && c.cleanup();
	const big = Math.max(W, H) * 1.06;
	const veil = el('div', 'veil', scareL), box = el('div', 'sbox', scareL), inner = el('div', '', box);
	box.style.width = box.style.height = n1(big) + 'px';
	box.style.left = n1(W / 2 - big / 2) + 'px'; box.style.top = n1(H / 2 - big / 2) + 'px';
	inner.innerHTML = '<svg viewBox="-100 -100 200 200">' + S.art + '</svg>';
	const s0 = clamp(70 * (c.s || 1) / big, .03, .3), dx = n1(x - W / 2), dy = n1(y - H / 2), r0 = n1(rand(-25, 25));
	sfx(S.sound);
	if (S.also) setTimeout(() => sfx(S.also), 120);
	let t = 0, done = false;
	if (S.live) fx(dt => { t += dt; if (done || !box.isConnected) return false; S.live(inner, t); return true; });
	// a tremble, then the leap
	const lunge = box.animate([
		{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s0 + ') rotate(' + r0 + 'deg)' },
		{ transform: 'translate(' + dx + 'px,' + (dy - 8) + 'px) scale(' + n1(s0 * 1.25 * 1000) / 1000 + ') rotate(' + r0 + 'deg)', offset: .22 },
		{ transform: 'translate(0px,0px) scale(1) rotate(0deg)' },
	], { duration: 520, easing: 'cubic-bezier(.75,0,.85,.2)', fill: 'forwards' });
	veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: 'ease-in', fill: 'forwards' });
	const finish = ms => setTimeout(() => {
		veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, fill: 'forwards' }).onfinish = () => { veil.remove(); box.remove(); done = true; scaring = false; };
	}, ms);
	lunge.onfinish = () => {
		inner.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06) translateY(-1%)' }, { transform: 'scale(.98)' }, { transform: 'scale(1.01)' }, { transform: 'scale(1)' }], { duration: 260 });
		if (S.end === 'slide') {   // squashed flat against the glass, then slides down it in its own goo
			sfx('splat');
			gooTrail(big, box);
			box.animate([{ transform: 'translate(0,0) scale(1,1)' }, { transform: 'translate(0,0) scale(1.04,.96)', offset: .12 }, { transform: 'translate(0,' + n1(H * .25) + 'px) scale(1.04,.97)', offset: .6 },
				{ transform: 'translate(0,' + n1(H * .95) + 'px) scale(1.04,.97)', opacity: 0 }], { duration: 2300, easing: 'ease-in', fill: 'forwards' });
			finish(1700);
			return;
		}
		if (S.end === 'crack') crackGlass(W / 2 + rand(-40, 40), H / 2 + rand(-30, 30));
		if (S.end === 'print') { handprint(W / 2, H / 2); sfx('splat'); }
		if (S.end === 'claws') clawMarks();
		// it goes on past the viewer, out of the screen
		setTimeout(() => {
			box.animate([{ transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' }, { transform: 'scale(2.9)', opacity: 0, filter: 'blur(14px)' }],
				{ duration: 340, easing: 'cubic-bezier(.5,0,1,.5)', fill: 'forwards' });
			finish(200);
		}, S.end === 'print' ? 380 : 560);
	};
}

// cracks in the screen, from where it hit
function crackGlass(x, y) {
	const n = irand(9, 13), R = Math.max(W, H) * .65;
	let d = '';
	for (let i = 0; i < n; i++) {
		let a = i / n * TAU + rand(-.2, .2), r = 0;
		const end = R * rand(.35, 1);
		d += 'M' + n1(x) + ' ' + n1(y);
		while (r < end) { r += rand(22, 70); a += rand(-.22, .22); d += 'L' + n1(x + Math.cos(a) * r) + ' ' + n1(y + Math.sin(a) * r); }
	}
	for (const rr of [rand(40, 70), rand(110, 170)]) {
		for (let i = 0; i < n; i++) {
			if (!chance(.7)) continue;
			const a0 = i / n * TAU + rand(-.1, .1), a1 = a0 + TAU / n * rand(.6, 1), am = (a0 + a1) / 2, k = rand(.9, 1.1);
			d += 'M' + n1(x + Math.cos(a0) * rr) + ' ' + n1(y + Math.sin(a0) * rr) + 'L' + n1(x + Math.cos(am) * rr * k) + ' ' + n1(y + Math.sin(am) * rr * k) + 'L' + n1(x + Math.cos(a1) * rr) + ' ' + n1(y + Math.sin(a1) * rr);
		}
	}
	const g = el('div', 'p', scareL);
	g.innerHTML = '<svg width="' + W + '" height="' + H + '"><path d="' + d + '" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2.8" stroke-linejoin="bevel"/>'
		+ '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.88)" stroke-width="1.1" stroke-linejoin="bevel"/>'
		+ '<circle cx="' + n1(x) + '" cy="' + n1(y) + '" r="12" fill="rgba(255,255,255,.4)"/></svg>';
	g.animate([{ opacity: 0 }, { opacity: 1, offset: .03 }, { opacity: 1, offset: .55 }, { opacity: 0 }], { duration: 2400, fill: 'forwards' }).onfinish = () => g.remove();
	sfx('crack');
}
// three scratches across the screen
function clawMarks() {
	const g = el('div', 'p', scareL), a = rand(-.5, -.2), len = Math.max(W, H) * .8;
	let paths = '';
	for (let i = -1; i <= 1; i++) {
		const cx = W / 2 + i * 70 * Math.cos(a + Math.PI / 2), cy = H / 2 + i * 70 * Math.sin(a + Math.PI / 2);
		let d = 'M' + n1(cx - Math.cos(a) * len / 2) + ' ' + n1(cy - Math.sin(a) * len / 2);
		for (let s = 1; s <= 12; s++) { const k = s / 12 - .5; d += 'L' + n1(cx + Math.cos(a) * len * k + rand(-4, 4)) + ' ' + n1(cy + Math.sin(a) * len * k + rand(-4, 4)); }
		paths += '<path d="' + d + '" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>';
	}
	g.innerHTML = '<svg width="' + W + '" height="' + H + '"><g fill="none" stroke-linecap="round" stroke-linejoin="round">'
		+ '<g stroke="rgba(0,0,0,.45)" stroke-width="13">' + paths + '</g><g stroke="#fff6f4" stroke-width="6">' + paths + '</g><g stroke="#ff7a6e" stroke-width="2" opacity=".7">' + paths + '</g></g></svg>';
	g.querySelectorAll('path').forEach((p, i) => p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 160, delay: (i % 3) * 40, easing: 'ease-out', fill: 'forwards' }));
	g.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: .5 }, { opacity: 0 }], { duration: 2400, fill: 'forwards' }).onfinish = () => g.remove();
}
// the slimy print the hand leaves on the glass, sliding down a little as it fades
function handprint(x, y) {
	const s = Math.min(W, H) / 220;
	let drips = '';
	for (let i = 0; i < 6; i++) { const dx = rand(-28, 28), h = rand(14, 40); drips += '<path d="M' + n1(dx - 2.2) + ' 26Q' + n1(dx) + ' ' + n1(26 + h) + ' ' + n1(dx + 2.2) + ' 26Z"/><circle cx="' + n1(dx) + '" cy="' + n1(26 + h) + '" r="2.4"/>'; }
	const g = svgBit('<g fill="rgba(120,160,80,.62)" stroke="rgba(60,90,40,.55)" stroke-width="1.2"><path d="M-30 30Q-36-4-28-20L26-20Q36-4 30 30Q0 40-30 30Z"/>'
		+ '<rect x="-29" y="-62" width="12" height="44" rx="6"/><rect x="-14" y="-74" width="12" height="56" rx="6"/><rect x="2" y="-72" width="12" height="54" rx="6"/><rect x="17" y="-60" width="11" height="42" rx="5.5"/>'
		+ '<rect x="-56" y="-26" width="11" height="34" rx="5.5" transform="rotate(-48 -50 -9)"/>' + drips + '</g>', 160, 180, scareL);
	g.style.transform = 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0) scale(' + n1(s * 100) / 100 + ')';
	g.animate([{ opacity: 0, transform: 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0) scale(' + n1(s * 110) / 100 + ')' },
		{ opacity: 1, transform: 'translate3d(' + n1(x) + 'px,' + n1(y) + 'px,0) scale(' + n1(s * 100) / 100 + ')', offset: .05 },
		{ opacity: .9, transform: 'translate3d(' + n1(x) + 'px,' + n1(y + 30) + 'px,0) scale(' + n1(s * 100) / 100 + ')', offset: .7 },
		{ opacity: 0, transform: 'translate3d(' + n1(x) + 'px,' + n1(y + 50) + 'px,0) scale(' + n1(s * 100) / 100 + ')' }], { duration: 3000, fill: 'forwards' }).onfinish = () => g.remove();
}
// the smear a squashed spider leaves on the glass as it slides down: from where it hit to the bottom of the
// screen, behind the spider, unrolling as it goes
function gooTrail(big, box) {
	const w = big * .4, top = H * .38, h = H - top + 40, g = el('div', 'p', scareL);
	scareL.insertBefore(g, box);
	let edge = 'M0 ' + n1(w * .2) + 'Q0 0 ' + n1(w * .2) + ' 0L' + n1(w * .8) + ' 0Q' + n1(w) + ' 0 ' + n1(w) + ' ' + n1(w * .2) + 'L' + n1(w) + ' ' + n1(h);
	for (let i = 8; i >= 0; i--) edge += 'L' + n1(w * i / 8) + ' ' + n1(h - (i % 2 ? rand(10, 40) : 0));
	let drips = '';
	for (let i = 0; i < 6; i++) { const x = rand(.08, .92) * w, y = rand(.25, .8) * h; drips += '<ellipse cx="' + n1(x) + '" cy="' + n1(y) + '" rx="' + n1(rand(3, 6)) + '" ry="' + n1(rand(8, 18)) + '"/>'; }
	g.style.cssText += 'left:' + n1(W / 2 - w / 2) + 'px;top:' + n1(top) + 'px;width:' + n1(w) + 'px;height:' + n1(h) + 'px;transform-origin:50% 0;transform:scaleY(0)';
	g.innerHTML = '<svg width="' + n1(w) + '" height="' + n1(h) + '"><path d="' + edge + 'Z" fill="rgba(120,185,55,.34)"/>'
		+ '<g fill="rgba(150,210,80,.35)">' + drips + '</g><path d="M' + n1(w * .12) + ' 10V' + n1(h * .8) + 'M' + n1(w * .88) + ' 10V' + n1(h * .7) + '" stroke="rgba(200,240,140,.35)" stroke-width="3" stroke-linecap="round"/></svg>';
	g.animate([{ transform: 'scaleY(0)', opacity: 1 }, { transform: 'scaleY(.3)', opacity: 1, offset: .45 }, { transform: 'scaleY(1)', opacity: .9, offset: .75 }, { transform: 'scaleY(1)', opacity: 0 }],
		{ duration: 3300, easing: 'ease-in', fill: 'forwards' }).onfinish = () => g.remove();
}

/* ------------------------------------------------------------------------------------------------ hits */

// kills: every banished creature ever (the first hits never scare); debt: hits since the last jump scare
function noteKill() {
	keep.set('kills', keep.get('kills', 0) + 1);
	keep.set('debt', keep.get('debt', 0) + 1);
}
function strike(c, x, y) {
	if (!c.alive || !live.has(c)) return;
	if (scareNow(c)) { noteKill(c); jumpScare(c, x, y); return; }
	c.hit(x, y);
}
// A mouse hit lands on pointerdown (instant); a touch only on the tap itself, so a scroll that happens to start on
// a creature does not kill it. Either way the page underneath never sees the click: the creature is usually gone
// (or no longer catches the pointer) by the time the button comes up, so the click that follows a mouse hit is
// swallowed wherever it lands - a spider squashed over a link must not open the link.
let lastHit = 0, swallow = 0;
function onHit(e) {
	const t = e.target, box = t && t.closest ? t.closest('.c') : null, c = box && box.__c;
	if (!c || !c.alive) return;
	if (e.type === 'pointerdown' && e.pointerType !== 'mouse') return;
	e.preventDefault();
	e.stopPropagation();
	const now = performance.now();
	if (e.type === 'click' && now - lastHit < 450) return;
	lastHit = now;
	if (e.type === 'pointerdown') swallow = now;
	strike(c, e.clientX, e.clientY);
}
stage.addEventListener('pointerdown', onHit);
stage.addEventListener('click', onHit);
addEventListener('click', e => {
	if (swallow && performance.now() - swallow < 800) { swallow = 0; e.preventDefault(); e.stopPropagation(); }
}, true);
addEventListener('pointerdown', e => { if (swallow && performance.now() - swallow > 50) swallow = 0; }, true);

/* ------------------------------------------------------------------------------------------------ who comes, and when */

// weights: how often each kind turns up relative to the others; ok: whether the screen suits it
const KINDS = {
	spider: { w: 21, name: 'Spider', make: () => new Crawler() },
	dangler: { w: 15, name: 'Dangling spider', make: () => new Dangler() },
	bat: { w: 13, name: 'Bat', make: () => chance(.3) && W > 700 && !REDUCED ? colony() : new Bat({ hang: chance(.22) }) },
	ghost: { w: 11, name: 'Ghost', make: () => new Ghost() },
	eyes: { w: 9, name: 'Eyes', make: () => new Eyes() },
	hand: { w: 8, name: 'Zombie hand', make: () => new Hand(), ok: () => W > 420 },
	centipede: { w: 7, name: 'Centipede', make: () => new Centipede() },
	cat: { w: 6, name: 'Black cat', make: () => new Cat(), ok: () => W > 520 },
	skull: { w: 5, name: 'Skull', make: () => new Skull(), ok: () => H > 360 },
	pumpkin: { w: 5, name: 'Jack-o\'-lantern', make: () => new Pumpkin(), ok: () => W > 420 },
	hatch: { w: 3, name: 'Spider brood', make: () => hatch(), ok: () => !REDUCED },
	witch: { w: 2, name: 'Witch', make: () => new Witch(), ok: () => W > 700 },
};
const NIGHT_BOOST = { eyes: 1.5, ghost: 1.4, bat: 1.3 }, HALLOWEEN_BOOST = { witch: 2.5, ghost: 1.5, pumpkin: 1.5 };
function encounter(kind) {
	W = viewW(); H = viewH();   // a scrollbar may have come or gone since the last resize
	if (!kind) {
		const recent = sess.get('recent', []), pool = [];
		let sum = 0;
		for (const k in KINDS) {
			const K = KINDS[k];
			if (K.ok && !K.ok()) continue;
			const w = K.w * (NIGHT && NIGHT_BOOST[k] || 1) * (HALLOWEEN && HALLOWEEN_BOOST[k] || 1) * (recent.indexOf(k) >= 0 ? .15 : 1);
			pool.push([k, w]);
			sum += w;
		}
		let r = Math.random() * sum;
		kind = pool[pool.length - 1][0];
		for (const [k, w] of pool) if ((r -= w) <= 0) { kind = k; break; }
		sess.set('recent', [kind].concat(recent).slice(0, 2));
	}
	try { KINDS[kind].make(); } catch (e) { report(e); }
}

// Every page: a first visit 2 to 5 seconds after the page has loaded, then, for as long as the visitor stays on
// the page, about one every 50 seconds at random (more often at night and on the 31st, half as often for visitors
// who asked for less motion).
const MEAN = 50;
let timer = 0, nextAt = 0;
const gap = () => clamp(-Math.log(1 - Math.random()) * MEAN * (HALLOWEEN ? .65 : 1) * (NIGHT ? .8 : 1) * (REDUCED ? 2 : 1), 14, 220);
function planIn(s) { nextAt = performance.now() + s * 1000; arm(); }
function arm() {
	clearTimeout(timer);
	if (doc.hidden || Date.now() >= CFG.end) return;
	timer = setTimeout(due, Math.max(200, nextAt - performance.now()));
}
function due() {
	if (doc.hidden || Date.now() >= CFG.end) return;
	// never while the visitor is typing, or the screen is already busy: try again shortly
	if (typing() || scaring || live.size >= (W < 640 ? 1 : HALLOWEEN || NIGHT ? 3 : 2)) { timer = setTimeout(due, 2000); return; }
	encounter();
	planIn(gap());
}
doc.addEventListener('visibilitychange', () => { if (doc.hidden) clearTimeout(timer); else arm(); });

// A long quiet spell (45 s without the mouse, keys or scrolling): eyes open at the edges and a spider creeps in,
// all of them gone the moment the visitor stirs. At most every five minutes; not on touch screens, not for
// visitors who asked for less motion.
function crowd() {
	quietCrowd = true;
	keep.set('crowdAt', Date.now());
	const sides = [0, 1, 2, 3].sort(() => Math.random() - .5);
	new Eyes({ watch: true, side: sides[0], life: 90 });
	setTimeout(() => quietCrowd && new Eyes({ watch: true, side: sides[1], life: 90 }), 2500);
	setTimeout(() => quietCrowd && new Crawler(chance(.5) ? 'widow' : 'tarantula', { creep: true }), 5000);
	setTimeout(() => quietCrowd && new Eyes({ watch: true, side: sides[2], life: 90, color: 'r' }), 9000);
}
setInterval(() => {
	if (REDUCED || TOUCH || doc.hidden || quietCrowd || live.size || scaring || Date.now() >= CFG.end) return;
	if (performance.now() - lastInput > 45000 && Date.now() - keep.get('crowdAt', 0) > 300000) crowd();
}, 5000);

// typing "boo" anywhere outside a text field calls up a few ghosts
let typed = '';
addEventListener('keydown', e => {
	if (typing() || e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1) return;
	typed = (typed + e.key.toLowerCase()).slice(-3);
	if (typed === 'boo') {
		typed = '';
		for (let i = 0; i < 3; i++) setTimeout(() => new Ghost({ dir: i % 2 ? -1 : 1, y: H * (.2 + i * .22) }), i * 450);
	}
}, { passive: true });

/* ------------------------------------------------------------------------------------------------ the lab (moderators) */

addCSS(`
.lab{position:absolute;left:12px;bottom:12px;width:250px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;
	pointer-events:auto;padding:10px 10px 9px;border-radius:12px;background:var(--ui-bg);color:var(--ui-tx);border:1px solid var(--ui-line);
	box-shadow:0 14px 40px rgba(0,0,0,.42);font:12px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.lab-hd{display:flex;align-items:center;gap:6px;margin:0 0 8px}
.lab-hd b{flex:1;font:400 19px/1 Creepster,Impact,fantasy;letter-spacing:.04em;color:var(--orange)}
.lab button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--ui-line);background:var(--ui-chip);border-radius:8px;padding:5px 7px;text-align:left}
.lab button:hover{border-color:var(--orange)}
.lab button:focus-visible{outline:2px solid var(--orange);outline-offset:1px}
.lab .hb{padding:0 8px;font-size:15px;line-height:1.3}
.lab-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.lab-row{display:flex;gap:4px;margin-top:6px}
.lab-row button{flex:1;text-align:center}
.lab button[aria-pressed=true]{border-color:var(--orange);background:rgba(255,138,31,.16)}
.lab p{margin:8px 0 0;color:var(--ui-mute);font-size:11px}
.lab.min{width:auto}
.lab.min .lab-hd{margin:0}
.lab.min>:not(.lab-hd){display:none}
.lab-launch{position:absolute;bottom:12px;left:12px;pointer-events:auto;border:1px solid #c19555;border-radius:50%;width:48px;height:48px;background:rgba(32,20,43,.95);color:#fff;font-size:24px;box-shadow:0 5px 20px #0009;cursor:pointer;display:none}
.lab-launch:focus-visible{outline:2px solid #ff8a1f}
@media(pointer:coarse), (max-width:700px){
.lab{left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));width:min(310px,calc(100vw - 16px));max-height:min(76dvh,620px);padding:10px;background:rgba(27,18,39,.72);border:1px solid rgba(215,157,90,.78);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);font-size:13px;color:#fff4e8}
.lab-hd b{font-size:19px}.lab button{padding:9px 7px;min-height:40px;color:#fff5e9;background:rgba(77,54,85,.50);border-color:rgba(221,181,132,.62);text-shadow:0 1px 2px rgba(0,0,0,.55)}.lab button:hover,.lab button:active{background:rgba(116,70,98,.70)}.lab .hb{min-width:35px;text-align:center}
.lab-grid{gap:5px}.lab-row{gap:5px}.lab p{display:none}
.lab.min{width:auto;padding:0;background:transparent;border:0;box-shadow:none;backdrop-filter:none}
.lab.min .lab-hd{display:none}
.lab.min .lab-launch{display:block;position:static}
}

`);
function labSync() {
	const b = ui.querySelector('[data-a=scare]');
	if (b) b.setAttribute('aria-pressed', labScare ? 'true' : 'false');
}
function lab() {
	if (!CFG.lab || ui.querySelector('.lab')) return;
	wantFont();
	const box = el('div', 'lab', ui);
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-label', 'Creature lab');
	box.innerHTML = '<button class="lab-launch" data-a="min" aria-label="Отвори лабораторията с чудовищата" title="Creature Lab">🕷️</button><div class="lab-hd"><b>Creature lab</b><button class="hb" data-a="min" aria-label="Fold the lab away" aria-expanded="true">&minus;</button>'
		+ '<button class="hb" data-a="close" aria-label="Close the lab">&times;</button></div>'
		+ '<div class="lab-grid">' + Object.keys(KINDS).map(k => '<button data-k="' + k + '">' + KINDS[k].name + '</button>').join('') + '</div>'
		+ '<div class="lab-row"><button data-a="scare" aria-pressed="false">Next hit scares</button><button data-a="crowd">Quiet-spell watchers</button></div>'
		+ '<div class="lab-row"><button data-a="frenzy">Frenzy</button><button data-a="clear">Clear the screen</button></div>'
		+ '<p>Moderators only. Visitors get a creature 2&ndash;5 s after every page load, then about one every 50 s while they stay; a visitor\'s first hits always banish, after that a jump scare can come at most every 2&frac12; minutes.</p>';
	function setLabMin(m) { box.classList.toggle('min',m);const btn=box.querySelector('.lab-hd [data-a=min]');btn.innerHTML=m?'+':'&minus;';btn.setAttribute('aria-expanded',String(!m)); }
if (matchMedia('(pointer:coarse), (max-width:700px)').matches) setLabMin(true);
box.addEventListener('click', e => {
		const b = e.target.closest('button');
		if (!b) return;
		const a = b.dataset.a;
		if (b.dataset.k) { encounter(b.dataset.k); if (matchMedia('(pointer:coarse), (max-width:700px)').matches) setLabMin(true); }
		else if (a === 'close') { setLabMin(true); }
		else if (a === 'min') { setLabMin(!box.classList.contains('min')); }
		else if (a === 'scare') { labScare = !labScare; labSync(); }
		else if (a === 'crowd') crowd();
		else if (a === 'frenzy') for (let i = 0; i < 4; i++) setTimeout(() => encounter(), i * 700);
		else if (a === 'clear') for (const c of live) { live.delete(c); c.el.remove(); c.cleanup && c.cleanup(); }
	});
}
const labHash = () => { if (location.hash === '#spooky-lab') lab(); };
addEventListener('hashchange', labHash);

/* ------------------------------------------------------------------------------------------------ go */

doc.body.appendChild(host);
labHash();
// the first visit: 2-5 s after the page's load event (navigation timing; this script itself starts about a second
// after it), counted from now if the browser does not say
const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
const loadedAt = nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : performance.now();
nextAt = loadedAt + rand(2000, 5000);
arm();
})();
