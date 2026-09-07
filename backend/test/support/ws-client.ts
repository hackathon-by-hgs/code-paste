import WebSocket from 'ws';

/**
 * A minimal realtime client for tests.
 *
 * Deliberately a real WebSocket against a real listening server: the handshake is where
 * authentication, the browser/device split and the connection caps are enforced, and none of that
 * is exercised by a mocked socket.
 */
export interface TestSocket {
  socket: WebSocket;
  messages: Array<{ v: number; type: string; id?: string; ts: string; data?: Record<string, unknown> }>;
  closeCode: number | null;
  waitFor(type: string, timeoutMs?: number): Promise<{ type: string; data?: Record<string, unknown> }>;
  waitForClose(timeoutMs?: number): Promise<number>;
  send(payload: unknown): void;
  close(): void;
}

export interface ConnectOptions {
  token?: string;
  /** Sends the token via the WebSocket subprotocol instead of the Authorization header. */
  useSubprotocol?: boolean;
  path?: string;
}

export function connect(port: number, options: ConnectOptions = {}): Promise<TestSocket> {
  const url = `ws://127.0.0.1:${port}${options.path ?? '/v1/realtime'}`;

  const socket =
    options.useSubprotocol && options.token
      ? new WebSocket(url, [`bearer.${options.token}`])
      : new WebSocket(url, {
          headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
        });

  const client: TestSocket = {
    socket,
    messages: [],
    closeCode: null,
    waitFor(type, timeoutMs = 5000) {
      const existing = client.messages.find((m) => m.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${type}"`)), timeoutMs);
        const onMessage = (raw: WebSocket.RawData) => {
          const parsed = JSON.parse(rawToString(raw)) as { type: string; data?: Record<string, unknown> };
          if (parsed.type === type) {
            clearTimeout(timer);
            socket.off('message', onMessage);
            resolve(parsed);
          }
        };
        socket.on('message', onMessage);
      });
    },
    waitForClose(timeoutMs = 5000) {
      if (client.closeCode !== null) return Promise.resolve(client.closeCode);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeoutMs);
        socket.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
    },
    send(payload) {
      socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    },
    close() {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    },
  };

  socket.on('message', (raw) => {
    try {
      client.messages.push(JSON.parse(rawToString(raw)) as TestSocket['messages'][number]);
    } catch {
      /* non-JSON frames are not part of the contract */
    }
  });
  socket.on('close', (code) => {
    client.closeCode = code;
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening socket')), 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(client);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Asserts that a handshake is refused, returning the HTTP status the server replied with. */
export async function expectHandshakeRejected(port: number, options: ConnectOptions = {}): Promise<number> {
  try {
    const client = await connect(port, options);
    client.close();
    throw new Error('Expected the handshake to be rejected, but it succeeded.');
  } catch (error) {
    const message = (error as Error).message;
    const match = /Unexpected server response: (\d{3})/.exec(message);
    if (!match) throw error;
    return Number(match[1]);
  }
}

/**
 * `ws` delivers a frame as a Buffer, an ArrayBuffer or an array of Buffers depending on how it was
 * fragmented. Normalising here means the callers never depend on which.
 */
function rawToString(raw: WebSocket.RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return Buffer.from(raw).toString('utf8');
}
