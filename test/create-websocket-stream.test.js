'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const { Duplex } = require('stream');
const { randomBytes } = require('crypto');

const createWebSocketStream = require('../lib/stream');
const Sender = require('../lib/sender');
const WebSocket = require('..');

describe('createWebSocketStream', () => {
  it('is exposed as a property of the `WebSocket` class', () => {
    assert.strictEqual(WebSocket.createWebSocketStream, createWebSocketStream);
  });

  it('returns a `Duplex` stream', () => {
    const duplex = createWebSocketStream(new EventEmitter());

    assert.ok(duplex instanceof Duplex);
  });

  it('passes the options object to the `Duplex` constructor', (done) => {
    const wss = new WebSocket.Server({ port: 0 }, () => {
      const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
      const duplex = createWebSocketStream(ws, {
        allowHalfOpen: false,
        encoding: 'utf8'
      });

      duplex.on('data', (chunk) => {
        assert.strictEqual(chunk, 'hi');

        duplex.on('close', () => {
          wss.close(done);
        });
      });
    });

    wss.on('connection', (ws) => {
      ws.send(Buffer.from('hi'));
      ws.close();
    });
  });

  describe('The returned stream', () => {
    it('buffers writes if `readyState` is `CONNECTING`', (done) => {
      const chunk = randomBytes(1024);
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

        assert.strictEqual(ws.readyState, 0);

        const duplex = createWebSocketStream(ws);

        duplex.write(chunk);
      });

      wss.on('connection', (ws) => {
        ws.on('message', (message) => {
          ws.on('close', (code, reason) => {
            assert.ok(message.equals(chunk));
            assert.strictEqual(code, 1005);
            assert.strictEqual(reason, '');
            wss.close(done);
          });
        });

        ws.close();
      });
    });

    it('errors if a write occurs when `readyState` is `CLOSING`', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('error', (err) => {
          assert.ok(duplex.destroyed);
          assert.ok(err instanceof Error);
          assert.strictEqual(
            err.message,
            'WebSocket is not open: readyState 2 (CLOSING)'
          );

          duplex.on('close', () => {
            wss.close(done);
          });
        });

        ws.on('open', () => {
          ws._receiver.on('conclude', () => {
            duplex.write('hi');
          });
        });
      });

      wss.on('connection', (ws) => {
        ws.close();
      });
    });

    it('errors if a write occurs when `readyState` is `CLOSED`', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('error', (err) => {
          assert.ok(duplex.destroyed);
          assert.ok(err instanceof Error);
          assert.strictEqual(
            err.message,
            'WebSocket is not open: readyState 3 (CLOSED)'
          );

          duplex.on('close', () => {
            wss.close(done);
          });
        });

        ws.on('close', () => {
          duplex.write('hi');
        });
      });

      wss.on('connection', (ws) => {
        ws.close();
      });
    });

    it('does not error if `_final()` is called while connecting', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);

        assert.strictEqual(ws.readyState, 0);

        const duplex = createWebSocketStream(ws);

        duplex.on('close', () => {
          wss.close(done);
        });

        duplex.resume();
        duplex.end();
      });
    });

    it('reemits errors', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('error', (err) => {
          assert.ok(err instanceof RangeError);
          assert.strictEqual(
            err.message,
            'Invalid WebSocket frame: invalid opcode 5'
          );

          duplex.on('close', () => {
            wss.close(done);
          });
        });
      });

      wss.on('connection', (ws) => {
        ws._socket.write(Buffer.from([0x85, 0x00]));
      });
    });

    it("does not suppress the throwing behavior of 'error' events", (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        createWebSocketStream(ws);
      });

      wss.on('connection', (ws) => {
        ws._socket.write(Buffer.from([0x85, 0x00]));
      });

      assert.strictEqual(process.listenerCount('uncaughtException'), 1);

      const [listener] = process.listeners('uncaughtException');

      process.removeAllListeners('uncaughtException');
      process.once('uncaughtException', (err) => {
        assert.ok(err instanceof Error);
        assert.strictEqual(
          err.message,
          'Invalid WebSocket frame: invalid opcode 5'
        );

        process.on('uncaughtException', listener);
        wss.close(done);
      });
    });

    it("is destroyed after 'end' and 'finish' are emitted (1/2)", (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const events = [];
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('end', () => {
          events.push('end');
          assert.ok(duplex.destroyed);
        });

        duplex.on('close', () => {
          assert.deepStrictEqual(events, ['finish', 'end']);
          wss.close(done);
        });

        duplex.on('finish', () => {
          events.push('finish');
          assert.ok(!duplex.destroyed);
          assert.ok(duplex.readable);

          duplex.resume();
        });

        ws.on('close', () => {
          duplex.end();
        });
      });

      wss.on('connection', (ws) => {
        ws.send('foo');
        ws.close();
      });
    });

    it("is destroyed after 'end' and 'finish' are emitted (2/2)", (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const events = [];
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('end', () => {
          events.push('end');
          assert.ok(!duplex.destroyed);
          assert.ok(duplex.writable);

          duplex.end();
        });

        duplex.on('close', () => {
          assert.deepStrictEqual(events, ['end', 'finish']);
          wss.close(done);
        });

        duplex.on('finish', () => {
          events.push('finish');
          assert.ok(duplex.destroyed);
        });

        duplex.resume();
      });

      wss.on('connection', (ws) => {
        ws.close();
      });
    });

    it('handles backpressure (1/3)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        // eslint-disable-next-line no-unused-vars
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
      });

      wss.on('connection', (ws) => {
        const duplex = createWebSocketStream(ws);

        duplex.resume();

        duplex.on('drain', () => {
          duplex.on('close', () => {
            wss.close(done);
          });

          duplex.end();
        });

        const chunk = randomBytes(1024);
        let ret;

        do {
          ret = duplex.write(chunk);
        } while (ret !== false);
      });
    });

    it('handles backpressure (2/3)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const called = [];
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);
        const read = duplex._read;

        duplex._read = () => {
          called.push('read');
          assert.ok(ws._receiver._writableState.needDrain);
          read();
          assert.ok(ws._socket.isPaused());
        };

        ws.on('open', () => {
          ws._socket.on('pause', () => {
            duplex.resume();
          });

          ws._receiver.on('drain', () => {
            called.push('drain');
            assert.ok(!ws._socket.isPaused());
          });

          const list = Sender.frame(randomBytes(16 * 1024), {
            fin: true,
            rsv1: false,
            opcode: 0x02,
            mask: false,
            readOnly: false
          });

          // This hack is used because there is no guarantee that more than
          // 16KiB will be sent as a single TCP packet.
          ws._socket.push(Buffer.concat(list));
        });

        duplex.on('resume', duplex.end);
        duplex.on('close', () => {
          assert.deepStrictEqual(called, ['read', 'drain']);
          wss.close(done);
        });
      });
    });

    it('handles backpressure (3/3)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const called = [];
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        const read = duplex._read;

        duplex._read = () => {
          called.push('read');
          assert.ok(!ws._receiver._writableState.needDrain);
          read();
          assert.ok(!ws._socket.isPaused());
        };

        ws.on('open', () => {
          ws._receiver.on('drain', () => {
            called.push('drain');
            assert.ok(ws._socket.isPaused());
            duplex.resume();
          });

          const list = Sender.frame(randomBytes(16 * 1024), {
            fin: true,
            rsv1: false,
            opcode: 0x02,
            mask: false,
            readOnly: false
          });

          ws._socket.push(Buffer.concat(list));
        });

        duplex.on('resume', duplex.end);
        duplex.on('close', () => {
          assert.deepStrictEqual(called, ['drain', 'read']);
          wss.close(done);
        });
      });
    });

    it('can be destroyed (1/2)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const error = new Error('Oops');
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('error', (err) => {
          assert.strictEqual(err, error);

          duplex.on('close', () => {
            wss.close(done);
          });
        });

        ws.on('open', () => {
          duplex.destroy(error);
        });
      });
    });

    it('can be destroyed (2/2)', (done) => {
      const wss = new WebSocket.Server({ port: 0 }, () => {
        const ws = new WebSocket(`ws://localhost:${wss.address().port}`);
        const duplex = createWebSocketStream(ws);

        duplex.on('close', () => {
          wss.close(done);
        });

        ws.on('open', () => {
          duplex.destroy();
        });
      });
    });
  });
});
