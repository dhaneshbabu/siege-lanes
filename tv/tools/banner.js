// Draws the Android TV launcher banner from the game's own art (run by tools/make-art.mjs).
import { kegIcon, pieceThumb } from '../../arena/src/render.js';

async function main() {
  await document.fonts.load('800 80px "Grenze Gotisch"');
  const c = document.getElementById('b');
  const g = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#202833');
  grd.addColorStop(1, '#151a22');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // A battlement along the bottom.
  g.fillStyle = '#28303c';
  g.fillRect(0, H * 0.86, W, H * 0.14);
  for (let x = 0; x < W; x += W / 13.33) g.fillRect(x, H * 0.8, W / 26, H * 0.07);
  const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  const knight = await load(pieceThumb('knight', 160));
  const keg = await load(kegIcon(160));
  // The knight on its courtyard tile, with its keg beside it.
  const t = H * 0.56;
  g.save();
  g.beginPath();
  g.roundRect ? g.roundRect(W * 0.05, H * 0.18, t, t, t * 0.12) : g.rect(W * 0.05, H * 0.18, t, t);
  g.clip();
  g.drawImage(knight, W * 0.05, H * 0.18, t, t);
  g.restore();
  g.drawImage(keg, W * 0.05 + t * 0.62, H * 0.18 + t * 0.42, t * 0.62, t * 0.62);
  // The name, as big as fits in the space on the right.
  g.fillStyle = '#ece2cc';
  g.textBaseline = 'alphabetic';
  const left = W * 0.44;
  const room = W - left - W * 0.05;
  let size = H * 0.4;
  g.font = `800 ${size}px "Grenze Gotisch"`;
  const wide = g.measureText('Powder').width;
  if (wide > room) size *= room / wide;
  g.font = `800 ${size}px "Grenze Gotisch"`;
  g.fillText('Powder', left, H * 0.47);
  g.fillText('Keg', left + (g.measureText('Powder').width - g.measureText('Keg').width) / 2, H * 0.47 + size * 0.92);
  document.title = 'done';
}
main();
