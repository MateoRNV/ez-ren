import { Application, Sprite, Texture, BufferImageSource } from 'pixi.js';

(async () => {
  const app = new Application();
  await app.init({ width: 100, height: 100, preference: 'webgl' });
  
  const rawArray = new Uint8Array(400); // 10x10 = 100 pixels = 400 bytes
  // Fill with red
  for(let i=0; i<400; i+=4) { rawArray[i] = 255; rawArray[i+3] = 255; }
  
  const bufferSource = new BufferImageSource({ resource: rawArray, width: 10, height: 10, format: "rgba8unorm" });
  const tex = new Texture({ source: bufferSource });
  
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5, 0.5);
  sprite.rotation = Math.PI / 4; // 45 deg
  
  const extract = app.renderer.extract;
  const pixels = extract.pixels({ target: sprite });
  
  console.log("Extracted width:", pixels.width, "height:", pixels.height);
  process.exit(0);
})();
