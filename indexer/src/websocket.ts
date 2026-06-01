import { WebSocketServer, WebSocket } from 'ws';
import { websocketLogger } from './logger.js';
import jwt from 'jsonwebtoken';

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB - Issue #35
const MAX_MESSAGES_PER_MINUTE = 100; // Issue #35
const WS_PORT = parseInt(process.env.WS_PORT ?? "8080", 10);
const JWT_SECRET = process.env.JWT_SECRET ?? 'default-development-secret-change-in-production-32chars';

interface ClientState {
  authenticated: boolean;
  messagesInWindow: number;
  windowStart: number;
  userId?: string;
}

const clientStates = new Map<WebSocket, ClientState>();

const wss = new WebSocketServer({ 
  port: WS_PORT,
  maxPayload: MAX_MESSAGE_SIZE,
});

wss.on('connection', (ws, request) => {
  const clientState: ClientState = {
    authenticated: false,
    messagesInWindow: 0,
    windowStart: Date.now(),
  };
  clientStates.set(ws, clientState);

  websocketLogger.info({ ip: request.socket.remoteAddress }, 'Client connected');

  // Issue #33 – JWT authentication for WebSocket
  const authHeader = request.headers['sec-websocket-protocol'] as string | undefined;
  if (authHeader && authHeader.startsWith('jwt.')) {
    try {
      const token = authHeader.substring(4); // Remove 'jwt.' prefix
      const payload = jwt.verify(token, JWT_SECRET) as { exp?: number; userId?: string };
      
      // Check token expiration
      if (payload.exp && payload.exp > Date.now() / 1000) {
        clientState.authenticated = true;
        clientState.userId = payload.userId;
        websocketLogger.info({ userId: payload.userId }, 'Client authenticated via JWT');
      } else {
        websocketLogger.warn('Expired JWT token from client');
      }
    } catch (err) {
      websocketLogger.warn({ error: err }, 'Invalid JWT token from client');
    }
  }

  // Issue #33 – Check if authentication is required
  const requireAuth = process.env.WS_REQUIRE_AUTH === 'true';
  if (requireAuth && !clientState.authenticated) {
    websocketLogger.warn('Unauthenticated client rejected');
    ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
    ws.close(1008, 'Authentication required');
    return;
  }

  ws.send(JSON.stringify({ type: 'welcome', message: 'Stellar Indexer Real-time Stream' }));

  // Issue #35 – Message rate limiting and validation per connection
  ws.on('message', (message: Buffer | string) => {
    // Message rate limiting per connection
    const now = Date.now();
    if (now - clientState.windowStart >= 60000) {
      clientState.messagesInWindow = 0;
      clientState.windowStart = now;
    }

    clientState.messagesInWindow++;
    if (clientState.messagesInWindow > MAX_MESSAGES_PER_MINUTE) {
      websocketLogger.warn({ userId: clientState.userId }, 'Client exceeded rate limit');
      ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    // Issue #35 – Message schema validation
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.toString());
    } catch {
      websocketLogger.warn({ userId: clientState.userId }, 'Invalid JSON received');
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      websocketLogger.warn({ userId: clientState.userId, type: (parsed as any)?.type ?? 'unknown' }, 'Invalid message format');
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format – type field required' }));
      return;
    }

    // Issue #35 – Message type validation
    const validTypes = ['ledger', 'transaction', 'operation', 'metrics', 'ping', 'pong'];
    if (!validTypes.includes((parsed as any).type)) {
      websocketLogger.warn({ userId: clientState.userId, type: (parsed as any).type }, 'Unknown message type');
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
      ws.close(1008, 'Unknown message type');
      return;
    }

    websocketLogger.debug({ userId: clientState.userId, type: (parsed as any).type }, 'Message validated and accepted');
  });

  ws.on('close', () => {
    clientStates.delete(ws);
    websocketLogger.info('Client disconnected');
  });
});

wss.on('error', (err) => {
  websocketLogger.error({ error: err.message }, 'WebSocket server error');
});

export function broadcastRealtimeUpdate(message: any): void {
  const data = JSON.stringify(message);
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      sent++;
    }
  });
  websocketLogger.debug({ clientCount: sent, ledger: message?.ledger }, 'Broadcasted realtime update');
}