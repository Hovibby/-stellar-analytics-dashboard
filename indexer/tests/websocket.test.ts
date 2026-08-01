import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';

const WS_PORT = 8081;

describe('WebSocket Server', () => {
  let server;

  beforeAll(() => {
    server = new WebSocketServer({ port: WS_PORT });
  });

  afterAll(() => {
    server.close();
  });

  test('should terminate the connection if the client does not respond to ping', (done) => {
    server.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
    });

    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    ws.on('open', () => {
      // Manually set isAlive to false to simulate a missed pong
      server.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.isAlive = false;
        }
      });

      // The server should terminate the connection after the next ping
      setTimeout(() => {
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        done();
      }, 31000);
    });
  });

  test('should not terminate the connection if the client responds to ping', (done) => {
    server.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
    });

    const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
    ws.on('open', () => {
      // The server should not terminate the connection
      setTimeout(() => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        done();
      }, 31000);
    });
  });
});
