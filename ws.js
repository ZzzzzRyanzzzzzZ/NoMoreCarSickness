// Minimal WebSocket server (RFC 6455) — just enough for small JSON text messages
// from the phone, so the app needs no extra dependency for it.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 64 * 1024;

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff]);
  return Buffer.concat([head, payload]);
}

function attach(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!req.url.startsWith(path) || !key) return socket.destroy();

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const conn = new EventEmitter();
    conn.send = text => { if (!socket.destroyed) socket.write(frame(1, Buffer.from(text))); };
    let buf = Buffer.alloc(0);

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        const masked = buf[1] & 0x80;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (len > MAX_FRAME) return socket.destroy();
        const maskAt = off;
        if (masked) off += 4;
        if (buf.length < off + len) return;

        const payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskAt + (i & 3)];
        buf = buf.subarray(off + len);

        if (op === 1) conn.emit('message', payload.toString('utf8'));
        else if (op === 8) { socket.end(frame(8, Buffer.alloc(0))); return; }
        else if (op === 9) socket.write(frame(10, payload));
      }
    });

    let closed = false;
    const close = () => { if (!closed) { closed = true; conn.emit('close'); } };
    socket.on('close', close);
    socket.on('error', close);
    onConnection(conn, req);
  });
}

module.exports = { attach };
