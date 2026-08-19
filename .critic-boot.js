const { app, bootApp } = await import('./src/app.js');
await import('./src/boot/modules.js');
bootApp(document.getElementById('game'), { harness: true });
const T = {};
let t = performance.now();
app.stage.render();                 // raw scene, no postfx
T.rawSceneRender = Math.round(performance.now() - t);
t = performance.now(); app.stage.render();
T.rawSceneRender2 = Math.round(performance.now() - t);
T.programs = app.stage.renderer.info.programs.length;
T.calls = app.stage.renderer.info.render.calls;
T.tris = app.stage.renderer.info.render.triangles;
t = performance.now();
app.clock.paused = true; app.clock.render();   // full path incl. postfx
T.fullFirst = Math.round(performance.now() - t);
t = performance.now(); app.clock.render();
T.fullSecond = Math.round(performance.now() - t);
T.programsAfter = app.stage.renderer.info.programs.length;
globalThis.__T = T; globalThis.__T.done = true;
