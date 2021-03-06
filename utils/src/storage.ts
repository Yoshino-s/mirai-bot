import { promisify } from "util";

import redis from "redis";
import { config } from "@mirai-bot/config";

import { Async } from "./async";

const prefix = "mirai_bot:";
let _client: redis.RedisClient;
const getClient = () => _client ?? (_client = redis.createClient(config.redis));

type Serializer<T> = {
  stringify: (data: T) => string;
  parse: (str: string) => T;
};

export class Storage<T> {
  readonly name: string;
  _data: T;
  client = getClient();
  constructor(
    name: string,
    defaultValue: T,
    readonly serializer: Serializer<T> = JSON
  ) {
    this.name = prefix + name;
    this._data = defaultValue;
  }
  async getData() {
    const r = await promisify(this.client.GET).bind(this.client)(this.name);
    if (r) {
      try {
        this._data = this.serializer.parse(r);
      } catch (e) {
        //
      }
    }
    return this._data;
  }
  async setData(data: T | Promise<T>) {
    this._data = await data;
    return await promisify(this.client.SET).bind(this.client)(
      this.name,
      this.serializer.stringify(this._data)
    );
  }
  get data(): T | Promise<T> {
    return this.getData();
  }

  set data(d: T | Promise<T>) {
    this.setData(d);
  }
}

export class SetStorage<T> extends Storage<Set<T>> {
  constructor(
    name: string,
    private readonly itemSerializer: Serializer<T> = JSON
  ) {
    super(name, new Set(), {
      stringify: (s) =>
        JSON.stringify(Array.from(s).map((v) => itemSerializer.stringify(v))),
      parse: (s) =>
        new Set(JSON.parse(s).map((s: string) => itemSerializer.parse(s))),
    });
  }
  async getData() {
    const r = await promisify(this.client.SMEMBERS).bind(this.client)(
      this.name
    );
    if (r) {
      try {
        this._data = new Set(
          r.map((s: string) => this.itemSerializer.parse(s))
        );
      } catch (e) {
        //
      }
    }
    return this._data;
  }
  async setData(data: Set<T> | Promise<Set<T>>) {
    this._data = await data;
    return Promise.all(
      Array.from(this._data).map((v) =>
        promisify(
          this.client.SADD as (
            k: string,
            v: string,
            cb: redis.Callback<number>
          ) => boolean
        ).bind(this.client)(this.name, this.itemSerializer.stringify(v))
      )
    );
  }

  async add(v: T) {
    return promisify(
      this.client.SADD as (
        s: string,
        k: string,
        cb: redis.Callback<number>
      ) => boolean
    )
      .bind(this.client)(this.name, this.itemSerializer.stringify(v))
      .then(Boolean);
  }

  async remove(v: T) {
    return promisify(
      this.client.SREM as (
        k: string,
        v: string,
        cb: redis.Callback<number>
      ) => boolean
    ).bind(this.client)(this.name, this.itemSerializer.stringify(v));
  }

  async has(v: T) {
    return promisify(this.client.SISMEMBER).bind(this.client)(
      this.name,
      this.itemSerializer.stringify(v)
    );
  }

  async forEach(cb: (v: T) => any) {
    return Async.forEach(Array.from(await this.data), cb);
  }
}

export class MapStorage<K, V> extends Storage<Map<K, V>> {
  constructor(
    name: string,
    private readonly keySerializer: Serializer<K> = JSON,
    private readonly valueSerializer: Serializer<V> = JSON
  ) {
    super(name, new Map(), {
      stringify: (s) =>
        JSON.stringify(
          Array.from(s.entries()).map(([k, v]) => [
            keySerializer.stringify(k),
            valueSerializer.stringify(v),
          ])
        ),
      parse: (s) =>
        new Map(
          JSON.parse(s).map(([k, v]: [string, string]) => [
            keySerializer.parse(k),
            valueSerializer.parse(v),
          ])
        ),
    });
  }
  async getData() {
    const r = await promisify(this.client.HGETALL).bind(this.client)(this.name);
    if (r) {
      try {
        this._data = new Map(
          Array.from(Object.entries(r)).map(([k, v]) => [
            this.keySerializer.parse(k),
            this.valueSerializer.parse(v as any),
          ])
        );
      } catch (e) {
        //
      }
    }
    return this._data;
  }
  async setData(data: Map<K, V> | Promise<Map<K, V>>) {
    this._data = await data;
    return Promise.all(
      Array.from(this._data.entries()).map(([k, v]) =>
        promisify(
          this.client.HSET as (
            h: string,
            k: string,
            v: string,
            cb: redis.Callback<number>
          ) => boolean
        ).bind(this.client)(
          this.name,
          this.keySerializer.stringify(k),
          this.valueSerializer.stringify(v)
        )
      )
    );
  }

  async set(k: K, v: V) {
    return promisify(
      this.client.HSET as (
        h: string,
        k: string,
        v: string,
        cb: redis.Callback<number>
      ) => boolean
    ).bind(this.client)(
      this.name,
      this.keySerializer.stringify(k),
      this.valueSerializer.stringify(v)
    );
  }

  async get(k: K) {
    const r = await promisify(this.client.HGET).bind(this.client)(
      this.name,
      this.keySerializer.stringify(k)
    );
    if (!r) return undefined;
    return this.valueSerializer.parse(r);
  }

  async remove(k: K) {
    return promisify(
      this.client.HDEL as (
        k: string,
        v: string,
        cb: redis.Callback<number>
      ) => boolean
    ).bind(this.client)(this.name, this.keySerializer.stringify(k));
  }

  async clear() {
    return promisify(
      this.client.DEL as (k: string, cb: redis.Callback<number>) => boolean
    ).bind(this.client)(this.name);
  }

  async forEach(cb: ([k, v]: [K, V]) => any) {
    return Async.forEach(Array.from((await this.data).entries()), cb);
  }
}
