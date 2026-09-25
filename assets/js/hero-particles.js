/* Hero: particles sampled from Gaussian noise flow along curved (Bézier) paths
   into the name. Hovering perturbs them; clicking sends them back to noise and
   samples again. */
(function () {
	const hero = document.getElementById("hero");
	const canvas = hero && hero.querySelector("canvas");
	const ctx = canvas && canvas.getContext("2d");
	if (!ctx) return;

	const hint = hero.querySelector(".hero__hint");

	const TEXT = "Juil Koo";
	const FONT = '"Source Sans 3", "Source Sans Pro", -apple-system, "Helvetica Neue", Arial, sans-serif';
	const INK = [17, 17, 17];
	const BLUE = [20, 135, 200]; // $kaist-link
	const LEVELS = 6; // speed buckets from INK (still) to BLUE (fast)
	const FADE = "rgba(255, 255, 255, 0.4)"; // partial clear each frame leaves short trails
	const HOLD_MS = 400; // show the noise before the first flow
	const NOISE_MS = 650; // data -> noise on click
	const FLOW_MS = 1800; // noise -> data, per particle
	const STAGGER_MS = 500; // left-to-right sweep plus jitter
	const PUSH = 1.8; // cursor repulsion
	const SWIRL = 0.5; // tangential share of the cursor force
	const TAU = Math.PI * 2;
	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const colors = [];
	for (let l = 0; l < LEVELS; l++) {
		const a = l / (LEVELS - 1);
		colors.push("rgb(" + INK.map((c, k) => Math.round(c + (BLUE[k] - c) * a)).join(",") + ")");
	}

	let W = 0, H = 0, n = 0, radius = 1;
	let tx, ty; // targets: text pixels, sorted by x
	let ex, ey; // noise sample
	let sx, sy; // start of the noising path
	let cx, cy; // Bézier control points of the flow
	let bx, by; // base position on the current path
	let ox, oy, vx, vy; // cursor perturbation, springs back to 0
	let px, py; // last drawn position, for speed coloring
	let delay, buckets, counts;

	let phase = "idle"; // "noise" | "flow" | "idle"
	let phaseStart = 0;
	let running = false, visible = true, last = 0;
	const mouse = { x: 0, y: 0, active: false };

	const easeIn = u => u * u * u;
	const easeInOut = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2);

	function gauss() {
		let u = 0;
		while (u === 0) u = Math.random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
	}

	function build() {
		W = hero.clientWidth;
		H = hero.clientHeight;
		if (!W || !H) return false;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = W * dpr;
		canvas.height = H * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		// Rasterize the text offscreen; its pixels become the targets
		const off = document.createElement("canvas");
		off.width = W;
		off.height = H;
		const g = off.getContext("2d");
		g.font = "700 100px " + FONT;
		let m = g.measureText(TEXT);
		const size = 100 * Math.min(0.62 * H / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent), 0.9 * W / m.width);
		g.font = "700 " + size + "px " + FONT;
		g.textAlign = "center";
		m = g.measureText(TEXT);
		g.fillText(TEXT, W / 2, (H + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
		const alpha = g.getImageData(0, 0, W, H).data;

		const step = Math.max(2.2, Math.min(3.2, size / 55));
		radius = step * 0.38;
		const pts = [];
		for (let y = step / 2; y < H; y += step) {
			for (let x = step / 2; x < W; x += step) {
				if (alpha[((y | 0) * W + (x | 0)) * 4 + 3] > 128) {
					pts.push([x + (Math.random() - 0.5) * step * 0.5, y + (Math.random() - 0.5) * step * 0.5]);
				}
			}
		}
		pts.sort((a, b) => a[0] - b[0]);

		n = pts.length;
		const arr = () => new Float32Array(n);
		[tx, ty, ex, ey, sx, sy, cx, cy, bx, by, ox, oy, vx, vy, px, py, delay] = Array.from({ length: 17 }, arr);
		buckets = Array.from({ length: LEVELS }, () => new Int32Array(n));
		counts = new Int32Array(LEVELS);
		pts.forEach(([x, y], i) => {
			tx[i] = x;
			ty[i] = y;
		});
		return true;
	}

	// Gaussian noise, paired with the x-sorted targets in x order (1D optimal
	// transport), so the particles move as one field instead of crossing paths
	function fillNoise() {
		const pts = [];
		for (let i = 0; i < n; i++) pts.push([W / 2 + gauss() * W * 0.2, H / 2 + gauss() * H * 0.25]);
		pts.sort((a, b) => a[0] - b[0]);
		pts.forEach(([x, y], i) => {
			ex[i] = x;
			ey[i] = y;
		});
	}

	function startFlow(start) {
		// Smooth bend field: neighbouring paths curve alike
		const f1 = TAU / (W * 0.45), f2 = TAU / (H * 1.5);
		const p1 = Math.random() * TAU, p2 = Math.random() * TAU;
		for (let i = 0; i < n; i++) {
			const dx = tx[i] - ex[i], dy = ty[i] - ey[i];
			const bend = 0.45 * Math.sin(ex[i] * f1 + p1) * Math.cos(ey[i] * f2 + p2);
			cx[i] = (ex[i] + tx[i]) / 2 - dy * bend;
			cy[i] = (ey[i] + ty[i]) / 2 + dx * bend;
			delay[i] = (tx[i] / W) * STAGGER_MS * 0.7 + Math.random() * STAGGER_MS * 0.3;
		}
		phase = "flow";
		phaseStart = start;
	}

	function resample() {
		sx.set(bx);
		sy.set(by);
		fillNoise();
		phase = "noise";
		phaseStart = performance.now();
		wake();
	}

	function update(now, dt) {
		if (phase === "noise") {
			const u = Math.min(1, Math.max(0, (now - phaseStart) / NOISE_MS));
			const e = easeIn(u);
			for (let i = 0; i < n; i++) {
				bx[i] = sx[i] + (ex[i] - sx[i]) * e;
				by[i] = sy[i] + (ey[i] - sy[i]) * e;
			}
			if (u === 1) startFlow(now);
		} else if (phase === "flow") {
			const el = now - phaseStart;
			for (let i = 0; i < n; i++) {
				const e = easeInOut(Math.min(1, Math.max(0, (el - delay[i]) / FLOW_MS)));
				const f = 1 - e;
				bx[i] = f * f * ex[i] + 2 * f * e * cx[i] + e * e * tx[i];
				by[i] = f * f * ey[i] + 2 * f * e * cy[i] + e * e * ty[i];
			}
			if (el >= FLOW_MS + STAGGER_MS) {
				phase = "idle";
				hint.classList.add("visible");
			}
		}

		// Springs pull the perturbation back to 0; the cursor pushes and swirls
		const R = H * 0.4, k = 0.035 * dt, damp = Math.pow(0.85, dt);
		let maxV = 0;
		for (let i = 0; i < n; i++) {
			let fx = -ox[i] * k, fy = -oy[i] * k;
			if (mouse.active) {
				const dx = bx[i] + ox[i] - mouse.x, dy = by[i] + oy[i] - mouse.y;
				const d2 = dx * dx + dy * dy;
				if (d2 < R * R && d2 > 0.01) {
					const d = Math.sqrt(d2);
					const s = (1 - d / R) * (1 - d / R) * PUSH * dt / d;
					fx += (dx - dy * SWIRL) * s;
					fy += (dy + dx * SWIRL) * s;
				}
			}
			vx[i] = (vx[i] + fx) * damp;
			vy[i] = (vy[i] + fy) * damp;
			ox[i] += vx[i] * dt;
			oy[i] += vy[i] * dt;
			maxV = Math.max(maxV, Math.abs(vx[i]) + Math.abs(vy[i]));
		}
		return maxV;
	}

	function draw(dt, clean) {
		if (clean) {
			ctx.clearRect(0, 0, W, H);
		} else {
			ctx.fillStyle = FADE;
			ctx.fillRect(0, 0, W, H);
		}
		counts.fill(0);
		for (let i = 0; i < n; i++) {
			const x = bx[i] + ox[i], y = by[i] + oy[i];
			const dx = x - px[i], dy = y - py[i];
			const l = Math.min(LEVELS - 1, (Math.sqrt(dx * dx + dy * dy) / dt * 1.5) | 0);
			buckets[l][counts[l]++] = i;
			px[i] = x;
			py[i] = y;
		}
		for (let l = 0; l < LEVELS; l++) {
			if (!counts[l]) continue;
			ctx.fillStyle = colors[l];
			ctx.beginPath();
			for (let j = 0; j < counts[l]; j++) {
				const i = buckets[l][j];
				ctx.moveTo(px[i] + radius, py[i]);
				ctx.arc(px[i], py[i], radius, 0, TAU);
			}
			ctx.fill();
		}
	}

	function frame(now) {
		const dt = Math.min(3, Math.max(0.25, (now - last) / 16.7));
		last = now;
		const maxV = update(now, dt);
		const keep = visible && (phase !== "idle" || maxV > 0.01);
		draw(dt, !keep); // clean final frame so no faded trail stays behind
		if (keep) requestAnimationFrame(frame);
		else running = false;
	}

	function wake() {
		if (running || !visible || !n || reduceMotion) return;
		running = true;
		last = performance.now();
		requestAnimationFrame(frame);
	}

	function init() {
		if (!build()) return;
		fillNoise();
		const [x0, y0] = reduceMotion ? [tx, ty] : [ex, ey];
		bx.set(x0);
		by.set(y0);
		px.set(x0);
		py.set(y0);
		if (reduceMotion) {
			draw(1, true);
			return;
		}
		startFlow(performance.now() + HOLD_MS);
		wake();
	}

	if (!reduceMotion) {
		hero.addEventListener("pointermove", e => {
			const r = hero.getBoundingClientRect();
			mouse.x = e.clientX - r.left;
			mouse.y = e.clientY - r.top;
			mouse.active = true;
			wake();
		});
		const release = () => {
			mouse.active = false;
			wake();
		};
		hero.addEventListener("pointerleave", release);
		hero.addEventListener("pointercancel", release);
		hero.addEventListener("pointerup", e => {
			if (e.pointerType !== "mouse") release();
		});
		hero.addEventListener("click", resample);
	}

	// Sample the text only once the web font is in (or after 2s without it)
	const fontReady = document.fonts ? document.fonts.load('700 100px "Source Sans 3"') : Promise.resolve();
	Promise.race([fontReady, new Promise(r => setTimeout(r, 2000))])
		.catch(() => {})
		.then(() => {
			init();
			let resizeTimer;
			new ResizeObserver(() => {
				if (hero.clientWidth === W && hero.clientHeight === H) return;
				clearTimeout(resizeTimer);
				resizeTimer = setTimeout(init, 150);
			}).observe(hero);
			new IntersectionObserver(entries => {
				visible = entries[0].isIntersecting;
				wake();
			}).observe(hero);
		});
})();
