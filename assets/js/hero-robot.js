/* 3D hero: a robot arm on a desk writes text on paper while particles sampled from 3D Gaussian
   noise flow into its pen strokes, and two Nupzuki figurines (Gaussian splats) assemble from noise
   beside it. Drag to orbit, click to resample, or type something for it to write.
   Studio HDRI and ash wood: Poly Haven (CC0). Paper: ambientCG (CC0). */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js";

const TAU = Math.PI * 2;
const DEFAULT_TEXT = "Hi there, I'm Juil Koo :)\n안녕하세요"; // two lines
const FONT = s => `500 ${s}px "Source Sans 3", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;

// Desk layout in world units: the desk top is y = 0 and the camera looks from +z
const DESK = { w: 7.6, d: 3.7, z: -0.8, leg: 2.9 }; // front edge at z = 1.05
const PAPER = { x: 0, y: 0.004, z: 0.15, w: 2.9, d: 1.35 };
const TEXT_W = 2.5, TEXT_H = 0.95; // box on the paper that text is fitted into
const BASE_Z = -0.9, SHOULDER_Y = 0.36; // the arm is bolted to the desk behind the paper
const L1 = 1.05, L2 = 1.0, PEN = 0.24, PEN_PITCH = -1.35; // arm links; the pen points down, tilted forward
const REST = [1.3, 0.55, -0.75]; // pen tip while idle: off to the right and behind the text
const LIFT = 0.16; // pen height while hopping between strokes
const DRAW_SPEED = 1.2, HOP_SPEED = 2.625, MIN_HOP = 0.107; // world units per second, the same for any text
const REACH = 0.7, RETRACT = 0.8, SCATTER = 0.9, MAX_FLOW = 1.4; // seconds
const MAX_N = 4200, PER_SAMPLE = 3, STROKE_WIDTH = 0.006, DRIFT = 0.03;
const FIGURES = [
	{ file: "nupzuki.splats", x: -2.05, z: -0.05, turn: 0.3 },
	{ file: "duck.splats", x: 2.05, z: -0.05, turn: -0.3 },
];
const FIG_START = 0.6, FIG_SPAN = 1.8; // figurines build up from their feet over this window (s)
const SPLAT_NOISE = 0.0032; // std of a splat while it is still noise (world units)
const NOISE_SHOWN = 0.3; // share of splats visible while they are noise; the rest fade in as they fly in
const FIG_POINT = 0.036; // point size for the disc fallback when the splat shader is unavailable
const FOV = 35, TAN = Math.tan((FOV / 2) * Math.PI / 180);
const EXPOSURE = 0.92; // overall brightness of the scene
const TARGET = [0, 0.35, -0.25], PHI_MIN = 0.12, PHI_MAX = 1.35;
const INK = srgb(0x1a1a1a), BLUE = srgb(0x1487c8), NOISE = srgb(0x7d8a99);
const NOISE_SIZE = 1.45; // noise points are drawn this much bigger, shrinking to crisp ink as they land

// Vertex colors are linear, so convert from sRGB
function linear(c) {
	c /= 255;
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgb(hex) {
	return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(linear);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const easeInOut = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2);

function gauss() {
	let u = 0;
	while (u === 0) u = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
}

/* ---- Text -> pen strokes: render it, thin the glyphs to a skeleton, cut that into strokes ---- */

// At most two lines, broken at the space that balances them best
function wrapLines(text, measure) {
	const words = text.split(" ");
	if (words.length < 2 || measure(text) < measure("M") * 16) return [text];
	let best = [text], widest = Infinity;
	for (let k = 1; k < words.length; k++) {
		const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
		const w = Math.max(measure(a), measure(b));
		if (w < widest) {
			widest = w;
			best = [a, b];
		}
	}
	return best;
}

// Zhang-Suen thinning, in place
function thin(img, w, h) {
	const del = [];
	for (let changed = true; changed; ) {
		changed = false;
		for (let pass = 0; pass < 2; pass++) {
			del.length = 0;
			for (let y = 1; y < h - 1; y++) {
				for (let x = 1; x < w - 1; x++) {
					const i = y * w + x;
					if (!img[i]) continue;
					const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
					const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
					const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
					if (b < 2 || b > 6) continue;
					const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
					if (a !== 1) continue;
					if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
					del.push(i);
				}
			}
			for (const i of del) img[i] = 0;
			if (del.length) changed = true;
		}
	}
}

// Skeleton -> graph (ends and junctions are nodes, the runs between them are edges) -> strokes.
// At a junction the straightest pair of runs continues as one stroke, the way a pen goes
// through the middle of an H but lifts for its crossbar.
function skeletonStrokes(img, w, h, spur) {
	const ring = [-w, 1 - w, 1, w + 1, w, w - 1, -1, -w - 1]; // clockwise from north
	const steps = [-w, 1, w, -1, 1 - w, w + 1, w - 1, -w - 1]; // orthogonal steps first
	const branches = i => {
		let c = 0;
		for (let k = 0; k < 8; k++) if (!img[i + ring[k]] && img[i + ring[(k + 1) % 8]]) c++;
		return c;
	};
	const pixels = [];
	for (let i = 0; i < w * h; i++) if (img[i]) pixels.push(i);

	const node = new Int32Array(w * h).fill(-1), nodes = [];
	for (const i of pixels) {
		if (node[i] >= 0 || branches(i) === 2) continue;
		const members = [], stack = [i];
		node[i] = nodes.length;
		while (stack.length) {
			const p = stack.pop();
			members.push(p);
			for (const o of ring) {
				const q = p + o;
				if (img[q] && node[q] < 0 && branches(q) !== 2) {
					node[q] = nodes.length;
					stack.push(q);
				}
			}
		}
		nodes.push(members);
	}

	const used = new Uint8Array(w * h), edges = [];
	const walk = (path, cur, prev, home) => {
		for (;;) {
			let next = -1;
			for (const o of steps) {
				const q = cur + o;
				if (img[q] && node[q] >= 0 && q !== prev && !(node[q] === home && path.length < 4)) {
					next = q;
					break;
				}
			}
			if (next < 0) {
				for (const o of steps) {
					const q = cur + o;
					if (img[q] && node[q] < 0 && !used[q]) {
						next = q;
						break;
					}
				}
			}
			if (next < 0) return path;
			const dx = (next % w) - (cur % w), dy = next - cur - dx;
			if (dx && dy) {
				// a diagonal step skips corner pixels that belong to this same run
				for (const q of [cur + dx, cur + dy]) if (img[q] && node[q] < 0) used[q] = 1;
			}
			path.push(next);
			if (node[next] >= 0) return path;
			used[next] = 1;
			prev = cur;
			cur = next;
		}
	};
	nodes.forEach((members, id) => {
		for (const s of members) {
			for (const o of steps) {
				const q = s + o;
				if (!img[q] || node[q] >= 0 || used[q]) continue;
				used[q] = 1;
				const path = walk([s, q], q, s, id);
				edges.push({ path, a: id, b: node[path[path.length - 1]] });
			}
		}
	});
	for (const s of pixels) {
		if (used[s] || node[s] >= 0) continue;
		used[s] = 1;
		const path = walk([s], s, -1, -1);
		path.push(s); // a loop with no junction (o, 0, ㅇ)
		edges.push({ path, a: -1, b: -1 });
	}

	// Drop short spurs that thinning leaves at corners and junctions
	const degree = new Int32Array(nodes.length);
	for (const e of edges) {
		if (e.a >= 0) degree[e.a]++;
		if (e.b >= 0) degree[e.b]++;
	}
	const lone = Array.from(degree, d => d === 0); // specks with no runs at all (pruned spur tips don't count)
	const kept = edges.filter(e => {
		const tip = e.a >= 0 && e.b >= 0 && ((degree[e.a] === 1 && degree[e.b] >= 3) || (degree[e.b] === 1 && degree[e.a] >= 3));
		if (!tip || e.path.length >= spur) return true;
		degree[e.a]--;
		degree[e.b]--;
		return false;
	});

	// Pair up runs at each node: kinks always continue, junctions continue only fairly straight
	const dirAt = key => {
		const p = kept[key >> 1].path, k = Math.min(6, p.length - 1);
		const [i0, i1] = key & 1 ? [p[p.length - 1], p[p.length - 1 - k]] : [p[0], p[k]];
		const dx = (i1 % w) - (i0 % w), dy = ((i1 / w) | 0) - ((i0 / w) | 0), l = Math.hypot(dx, dy) || 1;
		return [dx / l, dy / l];
	};
	const ends = nodes.map(() => []);
	kept.forEach((e, k) => {
		if (e.a >= 0) ends[e.a].push(2 * k);
		if (e.b >= 0) ends[e.b].push(2 * k + 1);
	});
	const partner = new Map();
	for (const list of ends) {
		if (list.length === 2) {
			partner.set(list[0], list[1]);
			partner.set(list[1], list[0]);
			continue;
		}
		const pairs = [];
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const a = dirAt(list[i]), b = dirAt(list[j]);
				pairs.push([a[0] * b[0] + a[1] * b[1], list[i], list[j]]); // -1 means straight through
			}
		}
		pairs.sort((p, q) => p[0] - q[0]);
		for (const [cos, i, j] of pairs) {
			if (cos > -0.77) break; // bends more than ~40°: separate strokes
			if (partner.has(i) || partner.has(j)) continue;
			partner.set(i, j);
			partner.set(j, i);
		}
	}

	const done = new Uint8Array(kept.length), strokes = [];
	const follow = key => {
		const pts = [];
		let k = key >> 1, end = key & 1;
		while (!done[k]) {
			done[k] = 1;
			const path = end ? kept[k].path.slice().reverse() : kept[k].path;
			for (let i = pts.length ? 1 : 0; i < path.length; i++) pts.push([path[i] % w, (path[i] / w) | 0]);
			const next = partner.get(2 * k + 1 - end);
			if (next === undefined) break;
			k = next >> 1;
			end = next & 1;
		}
		return pts;
	};
	for (let key = 0; key < 2 * kept.length; key++) if (!done[key >> 1] && !partner.has(key)) strokes.push({ pts: follow(key) });
	for (let k = 0; k < kept.length; k++) if (!done[k]) strokes.push({ pts: follow(2 * k) });
	nodes.forEach((members, id) => {
		if (!lone[id]) return;
		const cx = members.reduce((s, i) => s + (i % w), 0) / members.length;
		const cy = members.reduce((s, i) => s + ((i / w) | 0), 0) / members.length;
		strokes.push({ pts: [[cx, cy]], dot: true }); // an isolated speck: the dot of i, j, punctuation
	});
	return strokes.filter(s => s.dot || s.pts.length > 1);
}

// Ramer-Douglas-Peucker
function simplify(pts, eps) {
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack = [[0, pts.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop();
		const [ax, ay] = pts[a], [bx, by] = pts[b];
		const len = Math.hypot(bx - ax, by - ay);
		let best = -1, far = eps;
		for (let k = a + 1; k < b; k++) {
			// closed loops start and end on the same pixel, so measure from that point instead
			const d = len < 1e-6
				? Math.hypot(pts[k][0] - ax, pts[k][1] - ay)
				: Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
			if (d > far) {
				far = d;
				best = k;
			}
		}
		if (best >= 0) {
			keep[best] = 1;
			stack.push([a, best], [best, b]);
		}
	}
	return pts.filter((_, k) => keep[k]);
}

// Handwriting direction: loops start at the top and run counterclockwise; other strokes start at
// their upper end, or at the left end when they are mostly horizontal
function orient(pts) {
	const a = pts[0], b = pts[pts.length - 1];
	if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 3) {
		let top = 0;
		for (let k = 1; k < pts.length; k++) if (pts[k][1] < pts[top][1]) top = k;
		const loop = pts.slice(top).concat(pts.slice(1, top + 1));
		let area = 0;
		for (let k = 1; k < loop.length; k++) area += loop[k - 1][0] * loop[k][1] - loop[k][0] * loop[k - 1][1];
		return area > 0 ? loop.reverse() : loop; // y points down, so a positive area is clockwise on screen
	}
	const vertical = Math.abs(a[1] - b[1]) > 0.3 * Math.abs(a[0] - b[0]);
	return (vertical ? b[1] < a[1] : b[0] < a[0]) ? pts.slice().reverse() : pts;
}

// Hangul syllables are written initial consonant -> vowel -> final consonant; guess which part a
// stroke belongs to from where it sits in the syllable block
function hangulPart(ch) {
	const code = ch.codePointAt(0) - 0xac00;
	if (code < 0 || code >= 11172) return null;
	const vowel = Math.floor((code % 588) / 28), final = code % 28 > 0;
	const side = [0, 1, 2, 3, 4, 5, 6, 7, 20].includes(vowel), under = [8, 12, 13, 17, 18].includes(vowel);
	return (u, v) => {
		if (final && v > (side ? 0.62 : 0.7)) return 2;
		if (side) return u > 0.5 ? 1 : 0;
		if (under) return v > (final ? 0.45 : 0.55) ? 1 : 0;
		if (u > 0.62) return 1.5; // compound vowel: ㅗ/ㅜ/ㅡ first, then ㅏ/ㅓ/ㅣ
		return v > (final ? 0.42 : 0.52) ? 1 : 0;
	};
}

function textStrokes(text) {
	const S = 110, c = document.createElement("canvas"), g = c.getContext("2d");
	g.font = FONT(S);
	const measure = t => g.measureText(t).width;
	const lines = text.includes("\n") ? text.split("\n") : wrapLines(text, measure), widths = lines.map(measure);
	const pad = Math.ceil(S * 0.3), lh = Math.ceil(S * 1.35);
	const w = Math.ceil(Math.max(...widths)) + 2 * pad, h = lh * lines.length + 2 * pad;
	if (w <= 2 * pad) return [];
	c.width = w;
	c.height = h;
	g.font = FONT(S);
	const boxes = [];
	lines.forEach((line, L) => {
		const x0 = pad + (w - 2 * pad - widths[L]) / 2, base = pad + L * lh + S;
		g.fillText(line, x0, base);
		let prefix = "";
		for (const ch of Array.from(line)) {
			const a = x0 + measure(prefix);
			prefix += ch;
			if (ch.trim()) boxes.push({ ch, x0: a, x1: x0 + measure(prefix), y0: base - S, y1: base + 0.35 * S, strokes: [] });
		}
	});
	const alpha = g.getImageData(0, 0, w, h).data;
	const img = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) img[i] = alpha[4 * i + 3] > 127 ? 1 : 0;

	// Small round blobs are dots (i, j, :, ., !). Take them out before thinning, which can erase
	// them completely (a 2x2 block loses all four pixels in one pass).
	const dots = [], seen = new Uint8Array(w * h), around = [1, -1, w, -w, w + 1, w - 1, 1 - w, -w - 1];
	for (let i = 0; i < w * h; i++) {
		if (!img[i] || seen[i]) continue;
		const blob = [], stack = [i];
		seen[i] = 1;
		while (stack.length) {
			const p = stack.pop();
			blob.push(p);
			for (const o of around) {
				if (img[p + o] && !seen[p + o]) {
					seen[p + o] = 1;
					stack.push(p + o);
				}
			}
		}
		let x0 = w, x1 = 0, y0 = h, y1 = 0, sx = 0, sy = 0;
		for (const p of blob) {
			const x = p % w, y = (p / w) | 0;
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
			sx += x;
			sy += y;
		}
		const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
		if (Math.max(bw, bh) < 0.2 * S && Math.max(bw, bh) < 2 * Math.min(bw, bh) && blob.length > 0.45 * bw * bh) {
			dots.push({ pts: [[sx / blob.length, sy / blob.length]], dot: true });
			for (const p of blob) img[p] = 0;
		}
	}
	thin(img, w, h);

	// Each stroke goes to the character box its centre falls in (or the nearest one)
	for (const s of skeletonStrokes(img, w, h, S * 0.07).concat(dots)) {
		const cx = s.pts.reduce((t, p) => t + p[0], 0) / s.pts.length, cy = s.pts.reduce((t, p) => t + p[1], 0) / s.pts.length;
		let box = boxes.find(b => cx >= b.x0 && cx < b.x1 && cy >= b.y0 && cy < b.y1), near = Infinity;
		if (!box) {
			for (const b of boxes) {
				const d = Math.hypot(cx - (b.x0 + b.x1) / 2, cy - (b.y0 + b.y1) / 2);
				if (d < near) {
					near = d;
					box = b;
				}
			}
		}
		if (box) box.strokes.push({ ...s, cx, cy });
	}

	// Within a character: (Hangul part), top to bottom, left to right, dots last
	const ordered = [];
	for (const box of boxes) {
		if (!box.strokes.length) continue;
		let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
		for (const s of box.strokes) {
			for (const [x, y] of s.pts) {
				x0 = Math.min(x0, x);
				x1 = Math.max(x1, x);
				y0 = Math.min(y0, y);
				y1 = Math.max(y1, y);
			}
		}
		const part = hangulPart(box.ch), band = Math.max(1, 0.18 * (y1 - y0));
		const keyed = box.strokes.map(s => {
			const pts = s.dot ? s.pts : orient(s.pts);
			const u = (s.cx - x0) / Math.max(1, x1 - x0), v = (s.cy - y0) / Math.max(1, y1 - y0);
			return { s, pts, key: [s.dot ? 1 : 0, part ? part(u, v) : 0, Math.round((pts[0][1] - y0) / band), pts[0][0]] };
		});
		keyed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.key[3] - b.key[3]);
		for (const { s, pts } of keyed) {
			if (s.dot) {
				const r = S * 0.035, [px, py] = pts[0];
				ordered.push(Array.from({ length: 13 }, (_, k) => [px - r * Math.sin((k / 12) * TAU), py - r * Math.cos((k / 12) * TAU)]));
			} else {
				ordered.push(simplify(pts, 0.8));
			}
		}
	}
	if (!ordered.length) return [];

	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const s of ordered) {
		for (const [x, y] of s) {
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
		}
	}
	const k = Math.min(TEXT_W / Math.max(1, x1 - x0), TEXT_H / Math.max(1, y1 - y0));
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
	// Down the page (image y) is toward the viewer (+z) on the desk
	const world = ordered.map(s => s.map(([x, y]) => [PAPER.x + (x - cx) * k, PAPER.y + 0.002, PAPER.z + (y - cy) * k]));
	world.width = STROKE_WIDTH * clamp((S * k) / 0.35, 0.5, 1.6); // strokes scale with the lettering
	return world;
}

/* ---- Pen motion and arm ---- */

// Timed segments: reach from rest, draw each stroke, hop between strokes, go back to rest
function penTimeline(strokes) {
	const segs = [];
	let t = 0, length = 0;
	const hop = (a, b, dur) => {
		segs.push({ t0: t, t1: t + dur, a, b });
		t += dur;
	};
	const first = strokes[0][0], lastStroke = strokes[strokes.length - 1];
	const last = lastStroke[lastStroke.length - 1];
	hop(REST, first, REACH);
	strokes.forEach((pts, k) => {
		if (k) {
			const a = strokes[k - 1][strokes[k - 1].length - 1];
			hop(a, pts[0], Math.max(MIN_HOP, dist(a, pts[0]) / HOP_SPEED));
		}
		const cum = [0];
		for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + dist(pts[j - 1], pts[j]));
		const len = cum[cum.length - 1], dur = Math.max(1e-3, len / DRAW_SPEED);
		segs.push({ t0: t, t1: t + dur, pts, cum, len });
		length += len;
		t += dur;
	});
	hop(last, REST, RETRACT);
	return { segs, length, width: strokes.width || STROKE_WIDTH, total: t };
}

function pointAlong(seg, d) {
	let j = 1;
	while (j < seg.cum.length - 1 && seg.cum[j] < d) j++;
	const u = clamp((d - seg.cum[j - 1]) / (seg.cum[j] - seg.cum[j - 1] || 1), 0, 1);
	return lerp3(seg.pts[j - 1], seg.pts[j], u);
}

function penAt(tl, time) {
	const seg = tl.segs.find(s => time <= s.t1) || tl.segs[tl.segs.length - 1];
	const u = clamp((time - seg.t0) / (seg.t1 - seg.t0), 0, 1);
	if (seg.pts) return { p: pointAlong(seg, u * seg.len), down: true };
	const e = easeInOut(u), p = lerp3(seg.a, seg.b, e);
	return { p: [p[0], p[1] + Math.sin(Math.PI * u) * LIFT, p[2]], down: false };
}

// Yaw toward the pen, then planar two-link IK (elbow up) for the wrist, which holds the pen pitch
function solveArm(p) {
	const dx = p[0], dz = p[2] - BASE_Z;
	const rw = Math.hypot(dx, dz) - PEN * Math.cos(PEN_PITCH);
	const hw = p[1] - SHOULDER_Y - PEN * Math.sin(PEN_PITCH);
	const d = clamp(Math.hypot(rw, hw), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
	const a2 = -Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
	const a1 = Math.atan2(hw, rw) - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
	return { yaw: Math.atan2(dx, dz), a1, a2, a3: PEN_PITCH - a1 - a2 };
}

// Stroke samples with a little width, ordered by when the pen passes them
function strokeParticles(tl) {
	const step = Math.max(0.008, (tl.length * PER_SAMPLE) / (MAX_N - 300));
	const list = [];
	for (const seg of tl.segs) {
		if (!seg.pts) continue;
		for (let d = 0; d <= seg.len; d += step) {
			const p = pointAlong(seg, d), q = pointAlong(seg, Math.min(seg.len, d + 0.01));
			const nl = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1;
			const nx = -(q[2] - p[2]) / nl, nz = (q[0] - p[0]) / nl; // across the stroke, in the paper
			const at = seg.t0 + (seg.len ? d / seg.len : 1) * (seg.t1 - seg.t0);
			for (let k = 0; k < PER_SAMPLE; k++) {
				const w = gauss() * tl.width;
				list.push([p[0] + nx * w, p[1] + Math.random() * 0.003, p[2] + nz * w, at]);
			}
		}
	}
	return list.sort((a, b) => a[3] - b[3]).slice(0, MAX_N);
}

/* ---- Scene ---- */

function canvasTexture(w, h, paint) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	paint(c.getContext("2d"), w, h);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function dotTexture() {
	return canvasTexture(64, 64, g => {
		const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		grad.addColorStop(0, "rgba(255, 255, 255, 1)");
		grad.addColorStop(0.55, "rgba(255, 255, 255, 1)");
		grad.addColorStop(1, "rgba(255, 255, 255, 0)");
		g.fillStyle = grad;
		g.fillRect(0, 0, 64, 64);
	});
}

// Light oak boards: a tone per board, long wavy grain, thin seams (also used as the bump map)
function woodTexture() {
	const tex = canvasTexture(2048, 1024, (g, w, h) => {
		const boards = 5, bh = h / boards;
		for (let b = 0; b < boards; b++) {
			const tone = 0.9 + 0.16 * Math.random();
			g.fillStyle = `rgb(${(216 * tone) | 0}, ${(180 * tone) | 0}, ${(138 * tone) | 0})`;
			g.fillRect(0, b * bh, w, bh);
			for (let k = 0; k < 70; k++) {
				const y0 = b * bh + Math.random() * bh, amp = 2 + Math.random() * 9, f = 0.0015 + Math.random() * 0.004, ph = Math.random() * TAU;
				const shade = Math.random();
				g.strokeStyle = `rgba(${(92 + 40 * shade) | 0}, ${(57 + 26 * shade) | 0}, ${(30 + 14 * shade) | 0}, ${0.05 + 0.13 * Math.random()})`;
				g.lineWidth = 0.6 + Math.random() * 2.8;
				g.beginPath();
				for (let x = 0; x <= w; x += 16) {
					const y = Math.min(b * bh + bh - 1, Math.max(b * bh + 1, y0 + amp * Math.sin(x * f + ph) + 3 * Math.sin(x * f * 3.1 + 2 * ph)));
					if (x) g.lineTo(x, y);
					else g.moveTo(x, y);
				}
				g.stroke();
			}
			g.fillStyle = "rgba(70, 45, 25, 0.35)"; // seam between boards
			g.fillRect(0, b * bh, w, 2);
		}
	});
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(0.25, 0.45); // uv is in world units on the extruded top
	tex.anisotropy = 8;
	return tex;
}

// Faint paper fibre
function paperTexture() {
	return canvasTexture(512, 256, (g, w, h) => {
		g.fillStyle = "#fbfaf6";
		g.fillRect(0, 0, w, h);
		for (let i = 0; i < 5000; i++) {
			g.fillStyle = `rgba(90, 80, 60, ${Math.random() * 0.03})`;
			g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1);
		}
	});
}

// Radiance .hdr (RGBE, flat or run-length encoded) -> half-float RGBA, bottom row first for WebGL
function parseHDR(buf) {
	const b = new Uint8Array(buf);
	let i = 0, w = 0, h = 0;
	while (!h) {
		let j = i;
		while (b[j] !== 10) j++;
		const m = /^-Y (\d+) \+X (\d+)/.exec(String.fromCharCode(...b.subarray(i, j)));
		if (m) [h, w] = [+m[1], +m[2]];
		i = j + 1;
	}
	const rgbe = new Uint8Array(4 * w), out = new Uint16Array(4 * w * h), half = THREE.DataUtils.toHalfFloat, one = half(1);
	for (let y = 0; y < h; y++) {
		if (b[i] === 2 && b[i + 1] === 2 && ((b[i + 2] << 8) | b[i + 3]) === w) {
			i += 4;
			for (let c = 0; c < 4; c++) {
				for (let x = 0; x < w; ) {
					let n = b[i++];
					if (n > 128) {
						n -= 128;
						const v = b[i++];
						for (let k = 0; k < n; k++) rgbe[4 * (x + k) + c] = v;
					} else {
						for (let k = 0; k < n; k++) rgbe[4 * (x + k) + c] = b[i++];
					}
					x += n;
				}
			}
		} else {
			rgbe.set(b.subarray(i, i + 4 * w));
			i += 4 * w;
		}
		for (let x = 0; x < w; x++) {
			const e = rgbe[4 * x + 3], s = e ? Math.pow(2, e - 136) : 0, o = 4 * ((h - 1 - y) * w + x);
			for (let c = 0; c < 3; c++) out[o + c] = half((rgbe[4 * x + c] + 0.5) * s);
			out[o + 3] = one;
		}
	}
	return { w, h, data: out };
}

// Soft studio light for reflections: a room with a few bright panels, prefiltered once (PMREM).
// Stands in until the studio HDRI has loaded.
function studioEnvironment(renderer) {
	const room = new THREE.Scene(), box = new THREE.BoxGeometry();
	const walls = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0xc9c3ba, side: THREE.BackSide, roughness: 1 }));
	walls.scale.set(14, 8, 14);
	walls.position.y = 3;
	room.add(walls, new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.5));
	const panel = (w, h, d, x, y, z, glow) => {
		const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(glow) }));
		m.scale.set(w, h, d);
		m.position.set(x, y, z);
		room.add(m);
	};
	panel(5, 0.1, 3, -1, 6.9, 1, 5.5); // ceiling softbox
	panel(0.1, 3, 5, -6.9, 3, 0.5, 3.2); // window on the left
	panel(0.1, 2, 3, 6.9, 2.5, -1, 1.2); // dim fill on the right
	const pmrem = new THREE.PMREMGenerator(renderer);
	const env = pmrem.fromScene(room, 0.04).texture;
	pmrem.dispose();
	return env;
}

// Soft dark ellipse to seat things on the desk (points cast no real shadows)
function contactShadow(scene, x, z, sx, sz) {
	const tex = canvasTexture(128, 128, g => {
		const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
		grad.addColorStop(0, "rgba(40, 28, 16, 0.5)");
		grad.addColorStop(1, "rgba(40, 28, 16, 0)");
		g.fillStyle = grad;
		g.fillRect(0, 0, 128, 128);
	});
	const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
	m.rotation.x = -Math.PI / 2;
	m.position.set(x, 0.002, z);
	scene.add(m);
	return m;
}

// A lacquered oak table (rounded top, apron, turned legs) on a floor that only shows shadows
function buildDesk(scene) {
	const wood = woodTexture();
	const top = new THREE.MeshPhysicalMaterial({ map: wood, bumpMap: wood, bumpScale: 0.6, roughness: 0.52, clearcoat: 0.28, clearcoatRoughness: 0.38 });
	const frame = new THREE.MeshPhysicalMaterial({ map: wood, bumpMap: wood, bumpScale: 0.6, color: 0xe2d8ca, roughness: 0.58, clearcoat: 0.2 });
	const mesh = (geometry, material, x, y, z) => {
		const m = new THREE.Mesh(geometry, material);
		m.position.set(x, y, z);
		m.castShadow = m.receiveShadow = true;
		scene.add(m);
		return m;
	};
	// top: a rounded rectangle extruded with bevelled edges
	const hw = DESK.w / 2, hd = DESK.d / 2, r = 0.1, outline = new THREE.Shape();
	outline.moveTo(-hw + r, -hd);
	outline.lineTo(hw - r, -hd);
	outline.quadraticCurveTo(hw, -hd, hw, -hd + r);
	outline.lineTo(hw, hd - r);
	outline.quadraticCurveTo(hw, hd, hw - r, hd);
	outline.lineTo(-hw + r, hd);
	outline.quadraticCurveTo(-hw, hd, -hw, hd - r);
	outline.lineTo(-hw, -hd + r);
	outline.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
	const slab = new THREE.ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 8 });
	slab.rotateX(-Math.PI / 2); // extrusion now points up; the outline lies in x-z
	slab.translate(0, -0.12, 0); // top face at y = 0
	mesh(slab, top, 0, 0, DESK.z);
	const lx = hw - 0.32, fz = DESK.z + hd - 0.32, bz = DESK.z - hd + 0.32;
	mesh(new THREE.BoxGeometry(2 * lx, 0.2, 0.06), frame, 0, -0.24, fz);
	mesh(new THREE.BoxGeometry(2 * lx, 0.2, 0.06), frame, 0, -0.24, bz);
	mesh(new THREE.BoxGeometry(0.06, 0.2, fz - bz), frame, -lx, -0.24, DESK.z);
	mesh(new THREE.BoxGeometry(0.06, 0.2, fz - bz), frame, lx, -0.24, DESK.z);
	for (const x of [-lx, lx]) for (const z of [fz, bz]) mesh(new THREE.CylinderGeometry(0.075, 0.05, DESK.leg, 28), frame, x, -0.14 - DESK.leg / 2, z);
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.12 }));
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -0.14 - DESK.leg;
	floor.receiveShadow = true;
	scene.add(floor);
	// the sheet being written on, over a second one set slightly askew
	const paperMaterial = new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.95 });
	const under = new THREE.Mesh(new THREE.PlaneGeometry(PAPER.w, PAPER.d), paperMaterial);
	under.rotation.set(-Math.PI / 2, 0, 0.05);
	under.position.set(PAPER.x + 0.06, PAPER.y - 0.002, PAPER.z + 0.04);
	under.receiveShadow = true;
	scene.add(under);
	const paper = new THREE.Mesh(new THREE.PlaneGeometry(PAPER.w, PAPER.d), paperMaterial);
	paper.rotation.x = -Math.PI / 2;
	paper.position.set(PAPER.x, PAPER.y, PAPER.z);
	paper.receiveShadow = true;
	scene.add(paper);
	return { woods: [top, frame], paper: paperMaterial };
}

// Scanned PBR maps replace the drawn textures once every map of the set has loaded
function loadMaps(dir, files, setup, apply) {
	const loader = new THREE.TextureLoader(), maps = {};
	let pending = Object.keys(files).length;
	for (const [slot, file] of Object.entries(files)) {
		maps[slot] = loader.load(dir + file, () => --pending || apply(maps), undefined, err => console.warn("hero: texture not loaded", file, err));
		maps[slot].wrapS = maps[slot].wrapT = THREE.RepeatWrapping;
		maps[slot].anisotropy = 8;
		setup(maps[slot]);
	}
	if (maps.map) maps.map.colorSpace = THREE.SRGBColorSpace;
}

// Ash veneer on the table (grain already runs along the desk; uv is in world units on the top)
function loadWood(dir, materials) {
	loadMaps(dir, { map: "wood_diff.jpg", normalMap: "wood_nor.jpg", arm: "wood_arm.jpg" }, t => t.repeat.set(0.3, 0.3), maps => {
		for (const m of materials) {
			Object.assign(m, { map: maps.map, normalMap: maps.normalMap, aoMap: maps.arm, roughnessMap: maps.arm, metalnessMap: maps.arm, bumpMap: null, roughness: 1, metalness: 1, aoMapIntensity: 0.6 });
			m.color.setScalar(1.12); // a touch lighter than the scan
			m.needsUpdate = true;
		}
	});
}

// Fine white paper with a faint fibre relief
function loadPaper(dir, material) {
	loadMaps(dir, { map: "paper_diff.jpg", normalMap: "paper_nor.jpg", roughnessMap: "paper_rough.jpg" }, t => t.repeat.set(2, 1), maps => {
		Object.assign(material, { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap, roughness: 1 });
		material.normalScale.set(0.5, 0.5);
		material.needsUpdate = true;
	});
}

function buildRobot(scene) {
	const shell = new THREE.MeshPhysicalMaterial({ color: 0xececea, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 });
	const metal = new THREE.MeshStandardMaterial({ color: 0x34373c, roughness: 0.35, metalness: 0.8 });
	const rubber = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.75 });
	const led = new THREE.MeshStandardMaterial({ color: 0x1487c8, emissive: 0x1487c8, emissiveIntensity: 1.5 });
	const ink = new THREE.MeshPhysicalMaterial({ color: 0x1487c8, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
	const group = (parent, x, y, z) => {
		const g = new THREE.Group();
		g.position.set(x, y, z);
		parent.add(g);
		return g;
	};
	const part = (geometry, material, parent, x = 0, y = 0, z = 0) => {
		const m = new THREE.Mesh(geometry, material);
		m.position.set(x, y, z);
		m.castShadow = m.receiveShadow = true;
		parent.add(m);
		return m;
	};
	const lathe = (profile, material, parent) => part(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48), material, parent);
	const joint = (parent, r, len) => {
		part(new THREE.CylinderGeometry(r, r, len, 40), shell, parent).rotation.z = Math.PI / 2;
		for (const side of [-1, 1]) part(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.012, 40), rubber, parent, side * (len / 2 + 0.006), 0, 0).rotation.z = Math.PI / 2;
		part(new THREE.TorusGeometry(r * 1.004, 0.0055, 8, 56), led, parent, len * 0.3, 0, 0).rotation.y = Math.PI / 2;
	};
	const link = (parent, len, r0, r1) => {
		part(new THREE.CylinderGeometry(r1, r0, len, 32), shell, parent, 0, 0, len / 2).rotation.x = Math.PI / 2;
	};

	const base = group(scene, 0, 0, BASE_Z);
	lathe([[0, 0], [0.25, 0], [0.26, 0.012], [0.26, 0.03], [0.245, 0.04], [0, 0.04]], metal, base); // flange
	for (let k = 0; k < 6; k++) {
		const a = (k / 6) * TAU + 0.3;
		part(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 12), rubber, base, 0.218 * Math.cos(a), 0.046, 0.218 * Math.sin(a)); // bolts
	}
	lathe([[0, 0.04], [0.19, 0.04], [0.19, 0.052], [0.175, 0.14], [0, 0.14]], shell, base);
	part(new THREE.TorusGeometry(0.178, 0.006, 8, 56), led, base, 0, 0.125, 0).rotation.x = Math.PI / 2;
	const yaw = group(base, 0, 0.14, 0);
	part(new THREE.CylinderGeometry(0.168, 0.168, 0.012, 48), metal, yaw, 0, 0.006, 0); // turning seam
	lathe([[0, 0.012], [0.165, 0.012], [0.165, 0.03], [0.14, 0.12], [0, 0.12]], shell, yaw);
	const shoulder = group(yaw, 0, SHOULDER_Y - 0.14, 0);
	joint(shoulder, 0.105, 0.26);
	link(shoulder, L1, 0.085, 0.068);
	const elbow = group(shoulder, 0, 0, L1);
	joint(elbow, 0.09, 0.22);
	link(elbow, L2, 0.068, 0.054);
	const wrist = group(elbow, 0, 0, L2);
	joint(wrist, 0.068, 0.17);
	// tool flange, gripper, and the pen it holds, along the wrist's +z; the nib ends at PEN
	part(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 32), metal, wrist, 0, 0, 0.075).rotation.x = Math.PI / 2;
	part(new THREE.BoxGeometry(0.1, 0.05, 0.04), rubber, wrist, 0, 0, 0.105);
	for (const side of [-1, 1]) part(new THREE.BoxGeometry(0.012, 0.035, 0.06), metal, wrist, side * 0.02, 0, 0.15);
	part(new THREE.CylinderGeometry(0.013, 0.013, 0.14, 20), ink, wrist, 0, 0, 0.15).rotation.x = Math.PI / 2;
	part(new THREE.ConeGeometry(0.013, 0.02, 20), metal, wrist, 0, 0, PEN - 0.01).rotation.x = Math.PI / 2;
	part(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0x3aa8ff }), wrist, 0, 0, PEN);
	const tipLight = new THREE.PointLight(0x3aa8ff, 0, 0.9, 2);
	tipLight.position.z = PEN;
	wrist.add(tipLight);
	contactShadow(scene, 0, BASE_Z, 0.9, 0.9);
	return { yaw, shoulder, elbow, wrist, tipLight };
}

// PointsMaterial plus a per-point size multiplier (the `pscale` attribute). Solid points are
// opaque discs that hide what is behind them, so a dense cloud reads as a surface.
function pointsMaterial(size, dot, solid) {
	const material = new THREE.PointsMaterial(
		solid
			? { size, map: dot, vertexColors: true, alphaTest: 0.5 }
			: { size, map: dot, vertexColors: true, transparent: true, depthWrite: false }
	);
	material.onBeforeCompile = shader => {
		shader.vertexShader = shader.vertexShader
			.replace("uniform float size;", "uniform float size;\nattribute float pscale;")
			.replace("gl_PointSize = size;", "gl_PointSize = size * pscale;");
	};
	return material;
}

// Particles that flow from noise to targets on a schedule; `ink` and `inkScale` are each one's
// final colour and size
function makeCloud(scene, max, size, dot, solid) {
	const f3 = () => new Float32Array(3 * max);
	const c = {
		n: 0, drawN: 0, fresh: 0, stage: "idle", t0: 0, until: 0,
		target: f3(), ink: f3(), noise: f3(), ctrl: f3(), from: f3(), wob: f3(), pos: f3(), col: f3(),
		arrive: new Float32Array(max), dur: new Float32Array(max),
		scale: new Float32Array(max).fill(NOISE_SIZE), inkScale: new Float32Array(max).fill(1),
	};
	for (let j = 0; j < 3 * max; j++) c.wob[j] = Math.random() * TAU;
	c.geometry = new THREE.BufferGeometry();
	c.posAttr = new THREE.BufferAttribute(c.pos, 3).setUsage(THREE.DynamicDrawUsage);
	c.colAttr = new THREE.BufferAttribute(c.col, 3).setUsage(THREE.DynamicDrawUsage);
	c.geometry.setAttribute("position", c.posAttr);
	c.sizeAttr = new THREE.BufferAttribute(c.scale, 1).setUsage(THREE.DynamicDrawUsage);
	c.geometry.setAttribute("color", c.colAttr);
	c.geometry.setAttribute("pscale", c.sizeAttr);
	const points = new THREE.Points(c.geometry, pointsMaterial(size, dot, solid));
	points.frustumCulled = false;
	scene.add(points);
	return c;
}

// Fresh Gaussian noise; the first `pair` samples are sorted along `axis` to match target order,
// so the flow moves as one field instead of crossing paths
function sampleNoise(c, count, pair, axis, center, sigma, floor) {
	const pts = Array.from({ length: count }, () => [0, 1, 2].map(k => center[k] + gauss() * sigma[k]));
	for (const p of pts) p[1] = Math.max(floor, p[1]);
	const paired = pts.slice(0, pair).sort((a, b) => a[axis] - b[axis]);
	paired.concat(pts.slice(pair)).forEach((p, i) => c.noise.set(p, 3 * i));
}

// Bézier control points from a smooth field, so neighbouring paths curve alike
function bend(ctrl, start, end, amp, count, stride = 3) {
	const p1 = Math.random() * TAU, p2 = Math.random() * TAU;
	for (let j = 0; j < stride * count; j += stride) {
		const dx = end[j] - start[j], dy = end[j + 1] - start[j + 1], dz = end[j + 2] - start[j + 2];
		const len = Math.hypot(dx, dy, dz) || 1, hl = Math.hypot(dx, dz) || 1;
		const ax = -dz / hl, az = dx / hl; // horizontal normal
		const ux = dx / len, uy = dy / len, uz = dz / len;
		const bx = -az * uy, by = az * ux - ax * uz, bz = ax * uy; // second normal
		const a = amp * Math.sin(start[j] * 1.3 + p1);
		const b = amp * 0.7 * Math.cos(start[j + 1] * 2.1 + start[j + 2] * 0.9 + p2);
		ctrl[j] = (start[j] + end[j]) / 2 + len * (a * ax + b * bx);
		ctrl[j + 1] = (start[j + 1] + end[j + 1]) / 2 + len * b * by;
		ctrl[j + 2] = (start[j + 2] + end[j + 2]) / 2 + len * (a * az + b * bz);
	}
}

// Scatter: from -> noise over SCATTER. Otherwise each particle waits as noise, flows during
// [arrive - dur, arrive] (slate -> blue -> its ink, big -> small) and then sits on its target.
function updateCloud(c, now) {
	const s = now / 1000, col = c.col, pos = c.pos, scale = c.scale;
	const drift = (j, k) => c.noise[j + k] + DRIFT * Math.sin(s * (0.7 + 0.1 * k) + c.wob[j + k]);
	const mix = (j, a, b, t) => {
		for (let k = 0; k < 3; k++) col[j + k] = a[k] + (b[k] - a[k]) * t;
	};
	const ink = j => [c.ink[j], c.ink[j + 1], c.ink[j + 2]];
	if (c.stage === "scatter") {
		const e = easeInOut(clamp((now - c.t0) / (SCATTER * 1000), 0, 1)), f = 1 - e;
		for (let i = 0, j = 0; i < c.drawN; i++, j += 3) {
			for (let k = 0; k < 3; k++) pos[j + k] = f * f * c.from[j + k] + 2 * f * e * c.ctrl[j + k] + e * e * drift(j, k);
			if (i < c.fresh) {
				mix(j, ink(j), NOISE, e);
				scale[i] = lerp(c.inkScale[i], NOISE_SIZE, e);
			} else {
				mix(j, NOISE, NOISE, 0);
				scale[i] = NOISE_SIZE;
			}
		}
	} else {
		const tc = (now - c.t0) / 1000;
		for (let i = 0, j = 0; i < c.n; i++, j += 3) {
			const u = (tc - c.arrive[i]) / c.dur[i] + 1;
			if (u >= 1) {
				pos.set(c.target.subarray(j, j + 3), j);
				col.set(c.ink.subarray(j, j + 3), j);
				scale[i] = c.inkScale[i];
			} else if (u <= 0) {
				for (let k = 0; k < 3; k++) pos[j + k] = drift(j, k);
				mix(j, NOISE, NOISE, 0);
				scale[i] = NOISE_SIZE;
			} else {
				const e = easeInOut(u), f = 1 - e;
				scale[i] = lerp(NOISE_SIZE, c.inkScale[i], e);
				for (let k = 0; k < 3; k++) pos[j + k] = f * f * drift(j, k) + 2 * f * e * c.ctrl[j + k] + e * e * c.target[j + k];
				if (u < 0.25) mix(j, NOISE, BLUE, u / 0.25);
				else if (u < 0.75) mix(j, BLUE, BLUE, 0);
				else mix(j, BLUE, ink(j), (u - 0.75) / 0.25);
			}
		}
	}
	c.geometry.setDrawRange(0, c.drawN);
	c.posAttr.needsUpdate = c.colAttr.needsUpdate = c.sizeAttr.needsUpdate = true;
}

/* ---- Gaussian splat figurines ---- */

// Each splat has a position, a 3D covariance and a colour, stored in data textures. The GPU moves it
// from noise to the figurine (or back, while scattering) and projects its covariance to a screen
// ellipse (EWA splatting); the CPU sorts splats back to front every frame they are drawn.
const SPLAT_VERTEX = `
uniform highp sampler2D tCenter; // xyz: position on the figurine, w: arrival time
uniform highp sampler2D tCovA; // xx, xy, xz of the covariance, w: flow duration
uniform highp sampler2D tCovB; // yy, yz, zz of the covariance, w: opacity while it is noise
uniform highp sampler2D tNoise; // xyz: noise position
uniform highp sampler2D tCtrl; // xyz: Bezier control point
uniform sampler2D tColor; // sRGB colour and opacity
uniform vec2 viewport, focal; // drawing-buffer pixels
uniform float time, scatter, noiseVar; // scatter < 0: building
uniform vec3 slate, blue;
attribute float splatIndex;
varying vec4 vColor;
varying vec2 vPos;

float ease(float u) {
	return u < 0.5 ? 4.0 * u * u * u : 1.0 - pow(2.0 - 2.0 * u, 3.0) / 2.0;
}

void main() {
	int i = int(splatIndex);
	ivec2 uv = ivec2(i % 1024, i / 1024);
	vec4 center = texelFetch(tCenter, uv, 0);
	vec4 covA = texelFetch(tCovA, uv, 0);
	vec4 covB = texelFetch(tCovB, uv, 0);
	vec3 noisePos = texelFetch(tNoise, uv, 0).xyz;
	vec3 ctrl = texelFetch(tCtrl, uv, 0).xyz;
	vec4 rgba = texelFetch(tColor, uv, 0);

	float e; // 0: a noise point, 1: the splat itself
	vec3 p, color;
	if (scatter >= 0.0) {
		float s = ease(clamp(scatter, 0.0, 1.0));
		p = mix(mix(center.xyz, ctrl, s), mix(ctrl, noisePos, s), s);
		e = 1.0 - s;
		color = mix(rgba.rgb, slate, s);
	} else {
		float u = clamp((time - center.w) / covA.w + 1.0, 0.0, 1.0);
		e = ease(u);
		p = mix(mix(noisePos, ctrl, e), mix(ctrl, center.xyz, e), e);
		color = u < 0.25 ? mix(slate, blue, u / 0.25) : (u < 0.75 ? blue : mix(blue, rgba.rgb, (u - 0.75) / 0.25));
	}
	mat3 cov3 = mat3(covA.x, covA.y, covA.z, covA.y, covB.x, covB.y, covA.z, covB.y, covB.z) * e + mat3(noiseVar) * (1.0 - e);

	vec4 cam = modelViewMatrix * vec4(p, 1.0);
	vec4 clip = projectionMatrix * cam;
	float bound = 1.2 * clip.w;
	if (clip.w <= 0.0 || abs(clip.x) > bound || abs(clip.y) > bound) {
		gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
		return;
	}
	// Jacobian of the perspective projection (view space, camera looking down -z) in pixels
	float z = cam.z;
	mat3 J = mat3(focal.x / -z, 0.0, 0.0, 0.0, focal.y / -z, 0.0, focal.x * cam.x / (z * z), focal.y * cam.y / (z * z), 0.0);
	mat3 T = J * mat3(modelViewMatrix);
	mat3 cov2 = T * cov3 * transpose(T);
	float a = cov2[0][0] + 0.3, b = cov2[0][1], d = cov2[1][1] + 0.3;
	float mid = 0.5 * (a + d), rad = length(vec2(0.5 * (a - d), b));
	float l1 = mid + rad, l2 = mid - rad;
	if (l2 <= 0.0) {
		gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
		return;
	}
	vec2 dir = abs(b) > 1e-8 ? normalize(vec2(b, l1 - a)) : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
	vec2 major = min(sqrt(2.0 * l1), 1024.0) * dir;
	vec2 minor = min(sqrt(2.0 * l2), 1024.0) * vec2(-dir.y, dir.x); // keeps the quad counter-clockwise
	vColor = vec4(color, mix(covB.w, rgba.a, e));
	vPos = position.xy;
	gl_Position = vec4(clip.xy / clip.w + (position.x * major + position.y * minor) * 2.0 / viewport, clip.z / clip.w, 1.0);
}`;

const SPLAT_FRAGMENT = `
varying vec4 vColor;
varying vec2 vPos;

void main() {
	float a = -dot(vPos, vPos);
	if (a < -4.0) discard;
	float alpha = exp(a) * vColor.a;
	gl_FragColor = vec4(alpha * vColor.rgb, alpha); // premultiplied, blended back to front
}`;

function half(h) {
	const e = (h >> 10) & 31, f = h & 1023, v = e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * (f / 1024);
	return h & 0x8000 ? -v : v;
}

// File: count, then int16 xyz / 16384, float16 covariance x 1e4 (xx xy xz yy yz zz), rgba bytes
function makeSplatFigure(scene, buf, f) {
	const n = new Uint32Array(buf, 0, 1)[0], rows = Math.ceil(n / 1024), size = 4 * 1024 * rows;
	const xyz = new Int16Array(buf, 4, 3 * n), cov = new Uint16Array(buf, 4 + 6 * n, 6 * n);
	const g = {
		n, center: new Float32Array(size), covA: new Float32Array(size), covB: new Float32Array(size),
		noise: new Float32Array(size), ctrl: new Float32Array(size), rgba: new Uint8Array(size),
		order: new Float32Array(n), depth: new Float32Array(n), keys: new Uint16Array(n),
	};
	g.rgba.set(new Uint8Array(buf, 4 + 18 * n, 4 * n));
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < 3; k++) {
			g.center[4 * i + k] = xyz[3 * i + k] / 16384;
			g.covA[4 * i + k] = half(cov[6 * i + k]) * 1e-4;
			g.covB[4 * i + k] = half(cov[6 * i + 3 + k]) * 1e-4;
		}
		g.covB[4 * i + 3] = Math.random() < NOISE_SHOWN ? 0.65 : 0; // a sparse noise cloud, not a solid blob
		g.order[i] = i;
	}
	const texture = (data, type) => {
		const t = new THREE.DataTexture(data, 1024, rows, THREE.RGBAFormat, type);
		t.needsUpdate = true;
		return t;
	};
	g.tex = [g.center, g.covA, g.covB, g.noise, g.ctrl].map(d => texture(d, THREE.FloatType));
	const geometry = new THREE.InstancedBufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]), 3));
	geometry.setIndex([0, 1, 2, 0, 2, 3]);
	g.orderAttr = new THREE.InstancedBufferAttribute(g.order, 1).setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute("splatIndex", g.orderAttr);
	geometry.instanceCount = n;
	g.uniforms = {
		tCenter: { value: g.tex[0] }, tCovA: { value: g.tex[1] }, tCovB: { value: g.tex[2] },
		tNoise: { value: g.tex[3] }, tCtrl: { value: g.tex[4] }, tColor: { value: texture(g.rgba, THREE.UnsignedByteType) },
		viewport: { value: new THREE.Vector2(1, 1) }, focal: { value: new THREE.Vector2(1, 1) },
		time: { value: 0 }, scatter: { value: -1 }, noiseVar: { value: SPLAT_NOISE * SPLAT_NOISE },
		slate: { value: new THREE.Vector3(0x7d / 255, 0x8a / 255, 0x99 / 255) }, // sRGB, written out as is
		blue: { value: new THREE.Vector3(0x14 / 255, 0x87 / 255, 0xc8 / 255) },
	};
	const material = new THREE.ShaderMaterial({
		uniforms: g.uniforms, vertexShader: SPLAT_VERTEX, fragmentShader: SPLAT_FRAGMENT,
		transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.CustomBlending,
		blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
		blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
	});
	g.mesh = new THREE.Mesh(geometry, material);
	g.mesh.position.set(f.x, 0, f.z);
	g.mesh.rotation.y = f.turn;
	g.mesh.frustumCulled = false;
	scene.add(g.mesh);
	return g;
}

// Noise around the figurine (in its own frame), sorted by height to match the feet-up build
function splatNoise(g) {
	const pts = Array.from({ length: g.n }, () => [gauss() * 0.36, Math.max(0.05, 0.55 + gauss() * 0.32), gauss() * 0.36]);
	pts.sort((a, b) => a[1] - b[1]).forEach((p, i) => g.noise.set(p, 4 * i));
}

function scheduleSplats(g, start) {
	for (let i = 0; i < g.n; i++) {
		g.center[4 * i + 3] = start + (i / g.n) * FIG_SPAN;
		g.covA[4 * i + 3] = MAX_FLOW - 0.5 * Math.random();
	}
}

const splatView = new THREE.Matrix4(), splatCounts = new Uint32Array(65536);

// Depth-sort splats back to front, using the same motion as the shader
function sortSplats(g, camera) {
	const m = splatView.multiplyMatrices(camera.matrixWorldInverse, g.mesh.matrixWorld).elements;
	const t = g.uniforms.time.value, sc = g.uniforms.scatter.value, { center, covA, noise, ctrl, depth, keys } = g;
	let lo = Infinity, hi = -Infinity;
	for (let i = 0, j = 0; i < g.n; i++, j += 4) {
		// scattering runs the same curve backwards (a quadratic Bézier reversed is the same curve)
		const e = sc >= 0 ? 1 - easeInOut(clamp(sc, 0, 1)) : easeInOut(clamp((t - center[j + 3]) / covA[j + 3] + 1, 0, 1));
		const f = 1 - e, w0 = f * f, w1 = 2 * f * e, w2 = e * e;
		const x = w0 * noise[j] + w1 * ctrl[j] + w2 * center[j];
		const y = w0 * noise[j + 1] + w1 * ctrl[j + 1] + w2 * center[j + 1];
		const z = w0 * noise[j + 2] + w1 * ctrl[j + 2] + w2 * center[j + 2];
		const d = m[2] * x + m[6] * y + m[10] * z + m[14];
		depth[i] = d;
		if (d < lo) lo = d;
		if (d > hi) hi = d;
	}
	const k = 65535 / (hi - lo || 1);
	splatCounts.fill(0);
	for (let i = 0; i < g.n; i++) {
		const key = ((depth[i] - lo) * k) | 0;
		keys[i] = key;
		splatCounts[key]++;
	}
	for (let b = 1; b < 65536; b++) splatCounts[b] += splatCounts[b - 1];
	for (let i = g.n - 1; i >= 0; i--) g.order[--splatCounts[keys[i]]] = i; // most negative z (farthest) first
	g.orderAttr.needsUpdate = true;
}

function main() {
	const hero = document.getElementById("hero");
	if (!hero) return;
	const hint = hero.querySelector(".hero__hint");
	const input = hero.querySelector(".hero__input");
	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	let renderer;
	try {
		renderer = new THREE.WebGLRenderer({ antialias: true });
	} catch (e) {
		if (window.heroFallback) window.heroFallback();
		return;
	}
	const el = renderer.domElement;
	const describe = text => el.setAttribute("aria-label", "A robot arm on a desk writing " + text.replace(/\n/g, " ") + " with particles, next to two Nupzuki figurines");
	el.setAttribute("role", "img");
	describe(DEFAULT_TEXT);
	el.style.cursor = "grab";
	hero.querySelector("canvas").replaceWith(el);
	hint.textContent = "drag to rotate · click to resample";

	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0xffffff, 1);
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.toneMappingExposure = EXPOSURE;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	scene.fog = new THREE.Fog(0xffffff, 5, 10);
	const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);

	scene.environment = studioEnvironment(renderer);
	scene.environmentIntensity = 0.55;
	scene.add(new THREE.HemisphereLight(0xfffaf2, 0xd8cbb8, 0.85)); // lifts the desk and paper, which face the dark studio ceiling
	const sun = new THREE.DirectionalLight(0xfff4e5, 2.1);
	sun.position.set(-2.5, 5, 3);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 20 });
	sun.shadow.camera.updateProjectionMatrix();
	sun.shadow.bias = -0.0004;
	scene.add(sun);

	const desk = buildDesk(scene);
	const robot = buildRobot(scene);
	const dot = dotTexture();
	const text = makeCloud(scene, MAX_N, 0.035, dot);
	const figs = { list: null, stage: "none", t0: 0, until: 0, discs: null }; // "build" | "scatter"
	text.ink.fill(0);
	for (let j = 0; j < 3 * MAX_N; j += 3) text.ink.set(INK, j);

	let tl = null;
	let penS = REST.slice();
	let theta = 0.2, phi = 0.75, vTheta = 0, vPhi = 0, sway = 0, interacted = false, drag = null;
	let radius = 4, running = false, visible = true, last = 0;
	// Particles leaving noise never have to wait before the pen starts over
	const lead = Math.max(0, MAX_FLOW - REACH);

	function loadText(strokes) {
		tl = penTimeline(strokes);
		const list = strokeParticles(tl);
		text.n = list.length;
		list.forEach((q, i) => {
			text.target.set(q.slice(0, 3), 3 * i);
			text.arrive[i] = q[3];
			text.dur[i] = MAX_FLOW - 0.5 * Math.random();
		});
	}

	const textNoise = count => sampleNoise(text, count, text.n, 0, [0, 0.85, 0.1], [1.15, 0.3, 0.55], 0.12);

	// Figurines assemble from noise into their splats, feet first; `start` is in seconds after figs.t0
	function buildFigures(start) {
		for (const g of figs.list) {
			bend(g.ctrl, g.noise, g.center, 0.3, g.n, 4);
			scheduleSplats(g, start);
			for (const t of g.tex) t.needsUpdate = true;
		}
		figs.stage = "build";
		figs.until = start + FIG_SPAN;
	}

	function updateFigures(now) {
		if (figs.discs) updateCloud(figs.discs, now);
		if (!figs.list || figs.discs) return;
		camera.updateMatrixWorld();
		for (const g of figs.list) {
			g.uniforms.time.value = (now - figs.t0) / 1000;
			g.uniforms.scatter.value = figs.stage === "scatter" ? (now - figs.t0) / (SCATTER * 1000) : -1;
			g.mesh.updateMatrixWorld();
			sortSplats(g, camera);
		}
	}

	// If the splat shader cannot run here, show the figurines as solid discs instead
	function discFallback() {
		const total = figs.list.reduce((t, g) => t + g.n, 0), c = makeCloud(scene, total, FIG_POINT, dot, true);
		const v = new THREE.Vector3();
		for (const g of figs.list) {
			g.mesh.visible = false;
			for (let i = 0; i < g.n; i++, c.n++) {
				v.set(g.center[4 * i], g.center[4 * i + 1], g.center[4 * i + 2]).applyMatrix4(g.mesh.matrixWorld);
				c.target.set([v.x, v.y, v.z], 3 * c.n);
				c.ink.set([linear(g.rgba[4 * i]), linear(g.rgba[4 * i + 1]), linear(g.rgba[4 * i + 2])], 3 * c.n);
				const sd = Math.sqrt(Math.max(g.covA[4 * i], g.covB[4 * i], g.covB[4 * i + 2]));
				c.inkScale[c.n] = clamp(2.4 * sd, 0.012, 0.08) / (TAN * FIG_POINT * 0.78);
			}
		}
		c.drawN = c.n;
		c.stage = "done";
		c.t0 = -1e9;
		figs.discs = c;
		wake();
	}
	renderer.debug.onShaderError = () => {
		if (!figs.list || figs.discs) return;
		console.warn("hero: Gaussian splat shader failed to compile; showing the figurines as discs");
		discFallback();
	};

	function updateStage(now) {
		if (text.stage === "scatter") {
			if (now - text.t0 >= SCATTER * 1000) {
				text.drawN = text.n;
				bend(text.ctrl, text.noise, text.target, 0.35, text.n);
				text.stage = "write";
				text.t0 = now + lead * 1000;
			}
		} else if (text.stage === "write") {
			if ((now - text.t0) / 1000 >= tl.total) {
				text.stage = "done";
				hint.classList.add("visible");
			}
		}
		if (figs.stage === "scatter" && now - figs.t0 >= SCATTER * 1000) {
			buildFigures(FIG_START);
			figs.t0 = now + lead * 1000;
		}
	}

	// Returns true while the arm is still moving
	function updateRobot(now, dt) {
		let pen, down = false;
		if (text.stage === "scatter") {
			penS = lerp3(penS, REST, 1 - Math.exp(-dt * 6));
			pen = penS;
		} else {
			({ p: pen, down } = penAt(tl, (now - text.t0) / 1000));
			penS = pen;
		}
		const q = solveArm(pen);
		robot.yaw.rotation.y = q.yaw;
		robot.shoulder.rotation.x = -q.a1;
		robot.elbow.rotation.x = -q.a2;
		robot.wrist.rotation.x = -q.a3;
		robot.tipLight.intensity += ((down ? 0.6 : 0) - robot.tipLight.intensity) * (1 - Math.exp(-dt * 10));
		return robot.tipLight.intensity > 0.01 || dist(pen, REST) > 1e-3;
	}

	// Returns true while the camera is still moving
	function updateCamera(now, dt) {
		if (!drag) {
			theta += vTheta;
			phi = clamp(phi + vPhi, PHI_MIN, PHI_MAX);
			const k = Math.pow(0.9, dt * 60);
			vTheta *= k;
			vPhi *= k;
		}
		const want = text.stage === "done" && !interacted && !reduceMotion ? 0.14 : 0;
		sway += (want - sway) * (1 - Math.exp(-dt * 0.8));
		const az = theta + sway * Math.sin((now / 12000) * TAU);
		camera.position.set(
			TARGET[0] + radius * Math.sin(az) * Math.cos(phi),
			TARGET[1] + radius * Math.sin(phi),
			TARGET[2] + radius * Math.cos(az) * Math.cos(phi)
		);
		camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
		return Boolean(drag) || sway > 1e-3 || Math.abs(vTheta) + Math.abs(vPhi) > 1e-5;
	}

	function frame(now) {
		const dt = clamp((now - last) / 1000, 0.001, 0.05);
		last = now;
		updateStage(now);
		updateCloud(text, now);
		const moving = updateRobot(now, dt);
		const orbiting = updateCamera(now, dt);
		updateFigures(now);
		renderer.render(scene, camera);
		const building = figs.list && !figs.discs && (figs.stage === "scatter" || (now - figs.t0) / 1000 < figs.until);
		if (visible && (text.stage !== "done" || moving || orbiting || building)) requestAnimationFrame(frame);
		else running = false;
	}

	function wake() {
		if (running || !visible) return;
		running = true;
		last = performance.now();
		requestAnimationFrame(frame);
	}

	// Blow the text back into noise, then write `strokes` (or the same text again);
	// a bare resample also rebuilds the figurines
	function rewrite(strokes) {
		const now = performance.now();
		text.fresh = text.n;
		text.from.set(text.pos.subarray(0, 3 * text.n));
		if (strokes) loadText(strokes);
		text.drawN = Math.max(text.fresh, text.n);
		textNoise(text.drawN);
		text.from.set(text.noise.subarray(3 * text.fresh, 3 * text.drawN), 3 * text.fresh); // newcomers start as noise
		bend(text.ctrl, text.from, text.noise, 0.25, text.drawN);
		text.stage = "scatter";
		text.t0 = now;
		if (!strokes && figs.list && !figs.discs) {
			for (const g of figs.list) {
				splatNoise(g);
				bend(g.ctrl, g.center, g.noise, 0.25, g.n, 4);
				g.tex[3].needsUpdate = g.tex[4].needsUpdate = true;
			}
			figs.stage = "scatter";
			figs.t0 = now;
		}
		wake();
	}

	// Reduced motion: no animation, everything shows up finished
	function showDone(strokes) {
		loadText(strokes);
		text.drawN = text.n;
		text.stage = "done";
		text.t0 = -1e9;
		penS = REST.slice();
		wake();
	}

	function resize() {
		const w = hero.clientWidth, h = hero.clientHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		// Keep both figurines in frame across the width, and the desk scene vertically
		radius = Math.max(2.75 / (TAN * camera.aspect), 1.45 / TAN);
		scene.fog.near = radius + 0.5;
		scene.fog.far = radius + 5.5;
		setSplatViewport();
		wake();
	}

	// The splat shader works in drawing-buffer pixels
	function setSplatViewport() {
		if (!figs.list) return;
		const pr = renderer.getPixelRatio(), w = hero.clientWidth * pr, h = hero.clientHeight * pr;
		for (const g of figs.list) {
			g.uniforms.viewport.value.set(w, h);
			g.uniforms.focal.value.set(h / 2 / TAN, h / 2 / TAN);
		}
	}

	// Figurines: Gaussian splats, pre-oriented (feet at y = 0, facing +z) and sorted feet-up
	function loadFigures() {
		const dir = hero.dataset.assets || "";
		Promise.all(FIGURES.map(f => fetch(dir + f.file).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))))
			.then(buffers => {
				figs.list = buffers.map((buf, k) => makeSplatFigure(scene, buf, FIGURES[k]));
				for (const f of FIGURES) contactShadow(scene, f.x, f.z, 0.95, 0.75);
				for (const g of figs.list) splatNoise(g);
				// start building now, however far the writing has got
				buildFigures(reduceMotion ? 0 : MAX_FLOW);
				figs.t0 = reduceMotion ? -1e9 : performance.now();
				setSplatViewport();
				wake();
			})
			.catch(err => console.warn("hero: figurines not shown", err)); // the desk works without them
	}

	// Drag orbits (full 360° around), a click without movement resamples
	el.addEventListener("pointerdown", e => {
		drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), tMove: 0, moved: false };
		el.setPointerCapture(e.pointerId);
		vTheta = vPhi = 0;
		wake();
	});
	el.addEventListener("pointermove", e => {
		if (!drag) return;
		const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
		drag.x = e.clientX;
		drag.y = e.clientY;
		if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
		drag.moved = interacted = true;
		drag.tMove = performance.now();
		el.style.cursor = "grabbing";
		vTheta = -dx * 0.009;
		vPhi = dy * 0.006;
		theta += vTheta;
		phi = clamp(phi + vPhi, PHI_MIN, PHI_MAX);
	});
	const release = e => {
		if (!drag) return;
		const now = performance.now();
		if (!drag.moved && e.type === "pointerup" && now - drag.t0 < 500 && !reduceMotion && tl) rewrite();
		if (now - drag.tMove > 80) vTheta = vPhi = 0; // no fling if the pointer had stopped
		drag = null;
		el.style.cursor = "grab";
	};
	el.addEventListener("pointerup", release);
	el.addEventListener("pointercancel", release);

	// Typed text: Enter writes it; an empty box goes back to the greeting
	if (input) {
		input.hidden = false;
		input.addEventListener("keydown", e => {
			if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || !tl) return; // 229: IME still composing
			e.preventDefault();
			const value = input.value.trim() || DEFAULT_TEXT;
			const strokes = textStrokes(value);
			if (!strokes.length) return;
			describe(value);
			if (reduceMotion) showDone(strokes);
			else rewrite(strokes);
		});
	}

	// Studio HDRI for lighting and reflections (the page background stays white)
	function loadEnvironment(dir) {
		fetch(dir + "studio.hdr")
			.then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
			.then(buf => {
				const { w, h, data } = parseHDR(buf);
				const equirect = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
				Object.assign(equirect, { mapping: THREE.EquirectangularReflectionMapping, colorSpace: THREE.LinearSRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, needsUpdate: true });
				const pmrem = new THREE.PMREMGenerator(renderer), old = scene.environment;
				scene.environment = pmrem.fromEquirectangular(equirect).texture;
				pmrem.dispose();
				equirect.dispose();
				if (old) old.dispose();
				wake();
			})
			.catch(err => console.warn("hero: studio lighting not loaded", err));
	}

	function start() {
		const strokes = textStrokes(DEFAULT_TEXT);
		if (!strokes.length) return;
		if (reduceMotion) {
			showDone(strokes);
		} else {
			loadText(strokes);
			text.drawN = text.n;
			textNoise(text.n);
			bend(text.ctrl, text.noise, text.target, 0.35, text.n);
			text.stage = "write";
			text.t0 = performance.now() + (lead + 0.3) * 1000;
		}
		loadFigures();
		loadEnvironment(hero.dataset.assets || "");
		loadWood(hero.dataset.assets || "", desk.woods);
		loadPaper(hero.dataset.assets || "", desk.paper);
		resize();
		new ResizeObserver(resize).observe(hero);
		new IntersectionObserver(entries => {
			visible = entries[0].isIntersecting;
			wake();
		}).observe(hero);
	}

	// The strokes come from the web font, so wait for it (or give up after 1.5 s)
	const fontReady = document.fonts ? document.fonts.load(FONT(110)) : Promise.resolve();
	Promise.race([fontReady, new Promise(r => setTimeout(r, 1500))]).catch(() => {}).then(start);
}

main();
