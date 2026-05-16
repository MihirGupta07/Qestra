/**
 * Simple pub/sub for Server-Sent Events clients.
 * The server calls broadcast() after every snapshot mutation;
 * each connected EventSource gets the stringified snapshot pushed to it.
 */
export type SseSender = (data: string) => void;

const clients = new Set<SseSender>();

export const sseBroadcaster = {
  add(send: SseSender): void {
    clients.add(send);
  },
  remove(send: SseSender): void {
    clients.delete(send);
  },
  broadcast(data: string): void {
    for (const send of clients) {
      try {
        send(data);
      } catch {
        clients.delete(send);
      }
    }
  },
  get size(): number {
    return clients.size;
  }
};
