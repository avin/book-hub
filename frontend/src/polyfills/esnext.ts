// pdfjs-dist 6 relies on very recent built-ins (Map#getOrInsert*, Math.sumPrecise)
// that are still missing in Safari, Firefox ESR and Chromium < 145.

type UpsertMap<K, V> = {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

function defineMethod(target: object, name: string, value: unknown) {
  if (name in target) {
    return;
  }

  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

function getOrInsert<K, V>(this: UpsertMap<K, V>, key: K, value: V) {
  if (!this.has(key)) {
    this.set(key, value);
  }

  return this.get(key) as V;
}

function getOrInsertComputed<K, V>(this: UpsertMap<K, V>, key: K, compute: (key: K) => V) {
  if (!this.has(key)) {
    this.set(key, compute(key));
  }

  return this.get(key) as V;
}

function sumPrecise(values: Iterable<number>) {
  let sum = 0;
  let compensation = 0;
  let count = 0;

  for (const value of values) {
    if (typeof value !== 'number') {
      throw new TypeError('Math.sumPrecise expects numbers');
    }

    const next = sum + value;
    compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
    sum = next;
    count += 1;
  }

  return count === 0 ? -0 : sum + compensation;
}

for (const prototype of [Map.prototype, WeakMap.prototype]) {
  defineMethod(prototype, 'getOrInsert', getOrInsert);
  defineMethod(prototype, 'getOrInsertComputed', getOrInsertComputed);
}

defineMethod(Math, 'sumPrecise', sumPrecise);

export {};
