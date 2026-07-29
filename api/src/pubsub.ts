import { EventEmitter } from "node:events";

/**
 * Minimal in-process pub/sub with an AsyncIterator-based subscribe API,
 * matching what graphql-js's `subscribe()` expects for a Subscription
 * field's `subscribe` resolver — avoids pulling in `graphql-subscriptions`
 * for a single topic (Issue #210).
 */
export class SimplePubSub<T = unknown> {
  private emitter = new EventEmitter();

  publish(topic: string, payload: T): void {
    this.emitter.emit(topic, payload);
  }

  subscribe(topic: string): AsyncIterableIterator<T> {
    const emitter = this.emitter;
    const queue: T[] = [];
    let pendingResolve: ((result: IteratorResult<T>) => void) | null = null;
    let closed = false;

    const listener = (payload: T) => {
      if (pendingResolve) {
        pendingResolve({ value: payload, done: false });
        pendingResolve = null;
      } else {
        queue.push(payload);
      }
    };

    emitter.on(topic, listener);

    const iterator: AsyncIterableIterator<T> = {
      next(): Promise<IteratorResult<T>> {
        if (closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift() as T, done: false });
        }
        return new Promise((resolve) => {
          pendingResolve = resolve;
        });
      },
      return(): Promise<IteratorResult<T>> {
        closed = true;
        emitter.off(topic, listener);
        if (pendingResolve) {
          pendingResolve({ value: undefined, done: true });
          pendingResolve = null;
        }
        return Promise.resolve({ value: undefined, done: true });
      },
      throw(err): Promise<IteratorResult<T>> {
        closed = true;
        emitter.off(topic, listener);
        return Promise.reject(err);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
  }
}

export const pubsub = new SimplePubSub();
