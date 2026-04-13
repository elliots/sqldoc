declare global {
  interface Float16Array<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike> {
    readonly BYTES_PER_ELEMENT: number
    readonly buffer: TArrayBuffer
    readonly byteLength: number
    readonly byteOffset: number
    readonly length: number
    readonly [Symbol.toStringTag]: 'Float16Array'
    at(index: number): number | undefined
    entries(): ArrayIterator<[number, number]>
    keys(): ArrayIterator<number>
    values(): ArrayIterator<number>
    [Symbol.iterator](): ArrayIterator<number>
    [index: number]: number
  }

  interface Float16ArrayConstructor {
    readonly prototype: Float16Array<ArrayBufferLike>
    new (length: number): Float16Array<ArrayBuffer>
    new (array: Iterable<number> | ArrayLike<number>): Float16Array<ArrayBuffer>
    new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float16Array<ArrayBufferLike>
    of(...items: number[]): Float16Array<ArrayBuffer>
    from(
      arrayLike: Iterable<number> | ArrayLike<number>,
      mapFn?: (value: number, index: number) => number,
      thisArg?: unknown,
    ): Float16Array<ArrayBuffer>
  }

  var Float16Array: Float16ArrayConstructor
}

export {}
