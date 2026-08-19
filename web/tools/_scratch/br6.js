const { app } = globalThis.__SB;
return app.bus.log.filter(e => e.evt.startsWith('run:') || e.evt.startsWith('field:') || e.evt === 'throw:choice' || e.evt === 'bat:drop')
  .map(e => e.evt + ' ' + JSON.stringify(e.payload).slice(0, 190)).join('\n');
