import { connect, createServer, type Server, type Socket } from 'node:net';

/** Where a push loses the network once the register is online again. */
export type PushCut =
  /** Half of the request reaches the core, then the line drops. The core must store nothing. */
  | 'request-halfway'
  /** The whole request reaches the core and it stores the batch, but its answer never arrives. */
  | 'response-lost';

const HEADER_END = '\r\n\r\n';

/** What one connection is doing with the request that is going through it. */
interface ConnectionState {
  cut: PushCut | undefined;
  /** For `request-halfway`: how many more bytes may reach the core before the cut. */
  bytesLeftBeforeCut: number;
}

/**
 * A TCP proxy between the register and a real core that plays the shop's internet connection: it can be offline, online,
 * or drop one push at a precise moment. The register's `HttpSyncTransport` talks to it exactly as to the core, so the
 * failures it sees are real socket errors and not simulated exceptions (E1-20, ADR 0066).
 */
export class FlakyNetworkProxy {
  readonly #server: Server;
  readonly #target: { host: string; port: number };
  readonly #sockets = new Set<Socket>();
  readonly #cuts = new Map<number, PushCut>();
  #online = false;
  #pushes = 0;

  private constructor(server: Server, target: { host: string; port: number }) {
    this.#server = server;
    this.#target = target;
  }

  /**
   * Starts the proxy offline, on a free local port.
   *
   * @param coreUrl the address of the real core, such as `http://127.0.0.1:8080`
   * @returns the running proxy
   */
  static async start(coreUrl: string): Promise<FlakyNetworkProxy> {
    const url = new URL(coreUrl);
    const target = { host: url.hostname, port: Number(url.port || 80) };
    const server = createServer();
    const proxy = new FlakyNetworkProxy(server, target);
    server.on('connection', (client) => proxy.#accept(client));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    return proxy;
  }

  /** @returns the address the register must use instead of the core's */
  get url(): string {
    const address = this.#server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The proxy is not listening');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  /** @returns how many pushes reached the proxy while it was online, cut or not */
  get pushesWhileOnline(): number {
    return this.#pushes;
  }

  /** Drops every open connection and refuses new ones, like a router that lost the line. */
  goOffline(): void {
    this.#online = false;
    for (const socket of this.#sockets) {
      socket.destroy();
    }
  }

  /** Lets connections through again. */
  goOnline(): void {
    this.#online = true;
  }

  /**
   * Makes a future push lose the network.
   *
   * @param pushNumber which push, counting from 1 the pushes made while online
   * @param cut the moment it drops
   */
  cutPush(pushNumber: number, cut: PushCut): void {
    this.#cuts.set(pushNumber, cut);
  }

  /** Closes the proxy and every connection through it. */
  async close(): Promise<void> {
    this.goOffline();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #accept(client: Socket): void {
    this.#track(client);
    if (!this.#online) {
      client.destroy();
      return;
    }
    const core = connect(this.#target.port, this.#target.host);
    this.#track(core);
    const state: ConnectionState = { cut: undefined, bytesLeftBeforeCut: 0 };
    const dropBoth = (): void => {
      client.destroy();
      core.destroy();
    };
    client.on('data', (chunk: Buffer) => this.#forwardRequest(chunk, state, core, dropBoth));
    core.on('data', (chunk: Buffer) => {
      if (state.cut === 'response-lost') {
        // The core already committed the batch: this is the moment a naive client would send it twice.
        dropBoth();
        return;
      }
      client.write(chunk);
    });
    client.on('error', dropBoth).on('close', dropBoth);
    core.on('error', dropBoth).on('close', dropBoth);
  }

  #forwardRequest(chunk: Buffer, state: ConnectionState, core: Socket, dropBoth: () => void): void {
    if (startsRequest(chunk)) {
      this.#pushes += 1;
      state.cut = this.#cuts.get(this.#pushes);
      if (state.cut === 'request-halfway') {
        state.bytesLeftBeforeCut = Math.floor(requestLength(chunk) / 2);
      }
    }
    if (state.cut !== 'request-halfway') {
      core.write(chunk);
      return;
    }
    if (state.bytesLeftBeforeCut > 0) {
      const part = chunk.subarray(0, state.bytesLeftBeforeCut);
      state.bytesLeftBeforeCut -= part.length;
      core.write(part);
    }
    if (state.bytesLeftBeforeCut <= 0) {
      // Let the half that was written leave before the line drops, so the core does receive an incomplete request.
      core.end(() => dropBoth());
    }
  }

  #track(socket: Socket): void {
    this.#sockets.add(socket);
    socket.on('close', () => this.#sockets.delete(socket));
  }
}

/** A chunk that begins a new HTTP request, as opposed to one that carries the rest of a body. */
function startsRequest(chunk: Buffer): boolean {
  const start = chunk.subarray(0, 8).toString('latin1');
  return start.startsWith('POST ') || start.startsWith('GET ');
}

/** The full size of the request whose headers begin in this chunk: headers plus `Content-Length`. */
function requestLength(chunk: Buffer): number {
  const text = chunk.toString('latin1');
  const headerEnd = text.indexOf(HEADER_END);
  const headers = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const contentLength = /\r\ncontent-length:\s*(\d+)/i.exec(headers);
  const headerBytes = headerEnd === -1 ? chunk.length : headerEnd + HEADER_END.length;
  return headerBytes + (contentLength === null ? 0 : Number(contentLength[1]));
}
