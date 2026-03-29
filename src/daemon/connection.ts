import net from "net";

const DEFAULT_SOCKET = process.env.CLAWDAEMON_SOCKET ?? "/tmp/clawdaemon.sock";

let connection: net.Socket | null = null;

export function connectToDaemon(socketPath = DEFAULT_SOCKET): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (connection && !connection.destroyed) {
      resolve(connection);
      return;
    }

    const socket = net.createConnection(socketPath, () => {
      connection = socket;
      process.stderr.write(`[clawdaemon] connected to daemon at ${socketPath}\n`);
      resolve(socket);
    });

    socket.on("error", (err) => {
      connection = null;
      reject(new Error(`Cannot connect to OpenClaw daemon at ${socketPath}: ${err.message}`));
    });

    socket.on("close", () => {
      connection = null;
      process.stderr.write("[clawdaemon] daemon connection closed\n");
    });
  });
}

export function getDaemonConnection(): net.Socket | null {
  return connection && !connection.destroyed ? connection : null;
}

export function isDaemonRunning(socketPath = DEFAULT_SOCKET): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}
