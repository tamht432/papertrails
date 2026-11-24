// Animation loop with a capped variable timestep.

export function createLoop({ update, render, maxDt = 1 / 20 }) {
  let raf = 0;
  let running = false;
  let last = 0;
  let time = 0;
  let frame = 0;

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const raw = last ? now - last : 1000 / 60;
    last = now;
    const dt = Math.min(raw / 1000, maxDt);
    time += dt;
    frame++;
    update(dt);
    render(dt);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** One manual fixed-dt step (the cine exporter drives the loop frame by frame). */
    step(dt) { time += dt; frame++; update(dt); render(dt); },
    get time() { return time; },
    get frame() { return frame; },
  };
}
