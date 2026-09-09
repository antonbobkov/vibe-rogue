// Clockwork Hollow — boot stub (M00).
// Replaced in M10 by the real boot / screen stack / input dispatch (TEC-02, PLN-06 M10).
// This is one of the four DOM-allowed modules (PLN-02 R2).

const BG = '#0d0f12';
const FG = '#d8d2c4';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const size = Math.max(12, Math.min(48, Math.floor(w / 22)));
  ctx.fillStyle = FG;
  ctx.font = `${size}px "DejaVu Sans Mono", "Consolas", "Menlo", "Liberation Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CLOCKWORK HOLLOW', Math.round(w / 2), Math.round(h / 2));
}

// TEC-13 debug and test hooks. Filled in by later milestones; the object exists from M00
// so the smoke test can assert the boot path ran.
window.CH = {};

window.addEventListener('resize', draw);
draw();
