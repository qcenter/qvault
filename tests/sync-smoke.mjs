// tests/sync-source.js
import assert from "node:assert/strict";

// node_modules/fake-indexeddb/build/esm/lib/errors.js
var messages = {
  AbortError: "A request was aborted, for example through a call to IDBTransaction.abort.",
  ConstraintError: "A mutation operation in the transaction failed because a constraint was not satisfied. For example, an object such as an object store or index already exists and a request attempted to create a new one.",
  DataCloneError: "The data being stored could not be cloned by the internal structured cloning algorithm.",
  DataError: "Data provided to an operation does not meet requirements.",
  InvalidAccessError: "An invalid operation was performed on an object. For example transaction creation attempt was made, but an empty scope was provided.",
  InvalidStateError: "An operation was called on an object on which it is not allowed or at a time when it is not allowed. Also occurs if a request is made on a source object that has been deleted or removed. Use TransactionInactiveError or ReadOnlyError when possible, as they are more specific variations of InvalidStateError.",
  NotFoundError: "The operation failed because the requested database object could not be found. For example, an object store did not exist but was being opened.",
  ReadOnlyError: 'The mutating operation was attempted in a "readonly" transaction.',
  TransactionInactiveError: "A request was placed against a transaction which is currently not active, or which is finished.",
  SyntaxError: "The keypath argument contains an invalid key path",
  VersionError: "An attempt was made to open a database using a lower version than the existing version."
};
var setErrorCode = (error, value) => {
  Object.defineProperty(error, "code", {
    value,
    writable: false,
    enumerable: true,
    configurable: false
  });
};
var AbortError = class extends DOMException {
  constructor(message = messages.AbortError) {
    super(message, "AbortError");
  }
};
var ConstraintError = class extends DOMException {
  constructor(message = messages.ConstraintError) {
    super(message, "ConstraintError");
  }
};
var DataError = class extends DOMException {
  constructor(message = messages.DataError) {
    super(message, "DataError");
    setErrorCode(this, 0);
  }
};
var InvalidAccessError = class extends DOMException {
  constructor(message = messages.InvalidAccessError) {
    super(message, "InvalidAccessError");
  }
};
var InvalidStateError = class extends DOMException {
  constructor(message = messages.InvalidStateError) {
    super(message, "InvalidStateError");
    setErrorCode(this, 11);
  }
};
var NotFoundError = class extends DOMException {
  constructor(message = messages.NotFoundError) {
    super(message, "NotFoundError");
  }
};
var ReadOnlyError = class extends DOMException {
  constructor(message = messages.ReadOnlyError) {
    super(message, "ReadOnlyError");
  }
};
var SyntaxError = class extends DOMException {
  constructor(message = messages.VersionError) {
    super(message, "SyntaxError");
    setErrorCode(this, 12);
  }
};
var TransactionInactiveError = class extends DOMException {
  constructor(message = messages.TransactionInactiveError) {
    super(message, "TransactionInactiveError");
    setErrorCode(this, 0);
  }
};
var VersionError = class extends DOMException {
  constructor(message = messages.VersionError) {
    super(message, "VersionError");
  }
};

// node_modules/fake-indexeddb/build/esm/lib/isSharedArrayBuffer.js
function isSharedArrayBuffer(input) {
  return typeof SharedArrayBuffer !== "undefined" && input instanceof SharedArrayBuffer;
}

// node_modules/fake-indexeddb/build/esm/lib/valueToKeyWithoutThrowing.js
var INVALID_TYPE = Symbol("INVALID_TYPE");
var INVALID_VALUE = Symbol("INVALID_VALUE");
var valueToKeyWithoutThrowing = (input, seen) => {
  if (typeof input === "number") {
    if (isNaN(input)) {
      return INVALID_VALUE;
    }
    return input;
  } else if (Object.prototype.toString.call(input) === "[object Date]") {
    const ms = input.valueOf();
    if (isNaN(ms)) {
      return INVALID_VALUE;
    }
    return new Date(ms);
  } else if (typeof input === "string") {
    return input;
  } else if (
    // https://w3c.github.io/IndexedDB/#ref-for-dfn-buffer-source-type
    input instanceof ArrayBuffer || isSharedArrayBuffer(input) || typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)
  ) {
    if ("detached" in input ? input.detached : input.byteLength === 0) {
      return INVALID_VALUE;
    }
    let arrayBuffer;
    let offset = 0;
    let length = 0;
    if (input instanceof ArrayBuffer || isSharedArrayBuffer(input)) {
      arrayBuffer = input;
      length = input.byteLength;
    } else {
      arrayBuffer = input.buffer;
      offset = input.byteOffset;
      length = input.byteLength;
    }
    return arrayBuffer.slice(offset, offset + length);
  } else if (Array.isArray(input)) {
    if (seen === void 0) {
      seen = /* @__PURE__ */ new Set();
    } else if (seen.has(input)) {
      return INVALID_VALUE;
    }
    seen.add(input);
    let hasInvalid = false;
    const keys = Array.from({
      length: input.length
    }, (_, i) => {
      if (hasInvalid) {
        return;
      }
      const hop = Object.hasOwn(input, i);
      if (!hop) {
        hasInvalid = true;
        return;
      }
      const entry2 = input[i];
      const key = valueToKeyWithoutThrowing(entry2, seen);
      if (key === INVALID_VALUE || key === INVALID_TYPE) {
        hasInvalid = true;
        return;
      }
      return key;
    });
    if (hasInvalid) {
      return INVALID_VALUE;
    }
    return keys;
  } else {
    return INVALID_TYPE;
  }
};
var valueToKeyWithoutThrowing_default = valueToKeyWithoutThrowing;

// node_modules/fake-indexeddb/build/esm/lib/valueToKey.js
var valueToKey = (input, seen) => {
  const result = valueToKeyWithoutThrowing_default(input, seen);
  if (result === INVALID_VALUE || result === INVALID_TYPE) {
    throw new DataError();
  }
  return result;
};
var valueToKey_default = valueToKey;

// node_modules/fake-indexeddb/build/esm/lib/cmp.js
var getType = (x) => {
  if (typeof x === "number") {
    return "Number";
  }
  if (Object.prototype.toString.call(x) === "[object Date]") {
    return "Date";
  }
  if (Array.isArray(x)) {
    return "Array";
  }
  if (typeof x === "string") {
    return "String";
  }
  if (x instanceof ArrayBuffer) {
    return "Binary";
  }
  throw new DataError();
};
var cmp = (first, second) => {
  if (second === void 0) {
    throw new TypeError();
  }
  first = valueToKey_default(first);
  second = valueToKey_default(second);
  const t1 = getType(first);
  const t2 = getType(second);
  if (t1 !== t2) {
    if (t1 === "Array") {
      return 1;
    }
    if (t1 === "Binary" && (t2 === "String" || t2 === "Date" || t2 === "Number")) {
      return 1;
    }
    if (t1 === "String" && (t2 === "Date" || t2 === "Number")) {
      return 1;
    }
    if (t1 === "Date" && t2 === "Number") {
      return 1;
    }
    return -1;
  }
  if (t1 === "Binary") {
    first = new Uint8Array(first);
    second = new Uint8Array(second);
  }
  if (t1 === "Array" || t1 === "Binary") {
    const length = Math.min(first.length, second.length);
    for (let i = 0; i < length; i++) {
      const result = cmp(first[i], second[i]);
      if (result !== 0) {
        return result;
      }
    }
    if (first.length > second.length) {
      return 1;
    }
    if (first.length < second.length) {
      return -1;
    }
    return 0;
  }
  if (t1 === "Date") {
    if (first.getTime() === second.getTime()) {
      return 0;
    }
  } else {
    if (first === second) {
      return 0;
    }
  }
  return first > second ? 1 : -1;
};
var cmp_default = cmp;

// node_modules/fake-indexeddb/build/esm/FDBKeyRange.js
var FDBKeyRange = class _FDBKeyRange {
  static only(value) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    value = valueToKey_default(value);
    return new _FDBKeyRange(value, value, false, false);
  }
  static lowerBound(lower, open = false) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    lower = valueToKey_default(lower);
    return new _FDBKeyRange(lower, void 0, open, true);
  }
  static upperBound(upper, open = false) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    upper = valueToKey_default(upper);
    return new _FDBKeyRange(void 0, upper, true, open);
  }
  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    if (arguments.length < 2) {
      throw new TypeError();
    }
    const cmpResult = cmp_default(lower, upper);
    if (cmpResult === 1 || cmpResult === 0 && (lowerOpen || upperOpen)) {
      throw new DataError();
    }
    lower = valueToKey_default(lower);
    upper = valueToKey_default(upper);
    return new _FDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }
  constructor(lower, upper, lowerOpen, upperOpen) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }
  // https://w3c.github.io/IndexedDB/#dom-idbkeyrange-includes
  includes(key) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    key = valueToKey_default(key);
    if (this.lower !== void 0) {
      const cmpResult = cmp_default(this.lower, key);
      if (cmpResult === 1 || cmpResult === 0 && this.lowerOpen) {
        return false;
      }
    }
    if (this.upper !== void 0) {
      const cmpResult = cmp_default(this.upper, key);
      if (cmpResult === -1 || cmpResult === 0 && this.upperOpen) {
        return false;
      }
    }
    return true;
  }
  get [Symbol.toStringTag]() {
    return "IDBKeyRange";
  }
};
var FDBKeyRange_default = FDBKeyRange;

// node_modules/fake-indexeddb/build/esm/lib/extractKey.js
var extractKey = (keyPath, value) => {
  if (Array.isArray(keyPath)) {
    const result = [];
    for (let item of keyPath) {
      if (item !== void 0 && item !== null && typeof item !== "string" && item.toString) {
        item = item.toString();
      }
      const key = extractKey(item, value).key;
      result.push(valueToKey_default(key));
    }
    return {
      type: "found",
      key: result
    };
  }
  if (keyPath === "") {
    return {
      type: "found",
      key: value
    };
  }
  let remainingKeyPath = keyPath;
  let object = value;
  while (remainingKeyPath !== null) {
    let identifier;
    const i = remainingKeyPath.indexOf(".");
    if (i >= 0) {
      identifier = remainingKeyPath.slice(0, i);
      remainingKeyPath = remainingKeyPath.slice(i + 1);
    } else {
      identifier = remainingKeyPath;
      remainingKeyPath = null;
    }
    const isSpecialIdentifier = identifier === "length" && (typeof object === "string" || Array.isArray(object)) || (identifier === "size" || identifier === "type") && typeof Blob !== "undefined" && object instanceof Blob || (identifier === "name" || identifier === "lastModified") && typeof File !== "undefined" && object instanceof File;
    if (!isSpecialIdentifier && (typeof object !== "object" || object === null || !Object.hasOwn(object, identifier))) {
      return {
        type: "notFound"
      };
    }
    object = object[identifier];
  }
  return {
    type: "found",
    key: object
  };
};
var extractKey_default = extractKey;

// node_modules/fake-indexeddb/build/esm/lib/cloneValueForInsertion.js
function cloneValueForInsertion(value, transaction) {
  if (transaction._state !== "active") {
    throw new Error("Assert: transaction state is active");
  }
  transaction._state = "inactive";
  try {
    return structuredClone(value);
  } finally {
    transaction._state = "active";
  }
}

// node_modules/fake-indexeddb/build/esm/FDBCursor.js
var getEffectiveObjectStore = (cursor) => {
  if (cursor.source instanceof FDBObjectStore_default) {
    return cursor.source;
  }
  return cursor.source.objectStore;
};
var makeKeyRange = (range, lowers, uppers) => {
  let lower = range !== void 0 ? range.lower : void 0;
  let upper = range !== void 0 ? range.upper : void 0;
  for (const lowerTemp of lowers) {
    if (lowerTemp === void 0) {
      continue;
    }
    if (lower === void 0 || cmp_default(lower, lowerTemp) === 1) {
      lower = lowerTemp;
    }
  }
  for (const upperTemp of uppers) {
    if (upperTemp === void 0) {
      continue;
    }
    if (upper === void 0 || cmp_default(upper, upperTemp) === -1) {
      upper = upperTemp;
    }
  }
  if (lower !== void 0 && upper !== void 0) {
    return FDBKeyRange_default.bound(lower, upper);
  }
  if (lower !== void 0) {
    return FDBKeyRange_default.lowerBound(lower);
  }
  if (upper !== void 0) {
    return FDBKeyRange_default.upperBound(upper);
  }
};
var FDBCursor = class {
  _gotValue = false;
  _position = void 0;
  // Key of previously returned record
  _objectStorePosition = void 0;
  _keyOnly = false;
  _key = void 0;
  _primaryKey = void 0;
  constructor(source, range, direction = "next", request, keyOnly = false) {
    this._range = range;
    this._source = source;
    this._direction = direction;
    this._request = request;
    this._keyOnly = keyOnly;
  }
  // Read only properties
  get source() {
    return this._source;
  }
  set source(val) {
  }
  get request() {
    return this._request;
  }
  set request(val) {
  }
  get direction() {
    return this._direction;
  }
  set direction(val) {
  }
  get key() {
    return this._key;
  }
  set key(val) {
  }
  get primaryKey() {
    return this._primaryKey;
  }
  set primaryKey(val) {
  }
  // https://w3c.github.io/IndexedDB/#iterate-a-cursor
  _iterate(key, primaryKey) {
    const sourceIsObjectStore = this.source instanceof FDBObjectStore_default;
    const records = this.source instanceof FDBObjectStore_default ? this.source._rawObjectStore.records : this.source._rawIndex.records;
    let foundRecord;
    if (this.direction === "next") {
      const range = makeKeyRange(this._range, [key, this._position], []);
      for (const record of records.values(range)) {
        const cmpResultKey = key !== void 0 ? cmp_default(record.key, key) : void 0;
        const cmpResultPosition = this._position !== void 0 ? cmp_default(record.key, this._position) : void 0;
        if (key !== void 0) {
          if (cmpResultKey === -1) {
            continue;
          }
        }
        if (primaryKey !== void 0) {
          if (cmpResultKey === -1) {
            continue;
          }
          const cmpResultPrimaryKey = cmp_default(record.value, primaryKey);
          if (cmpResultKey === 0 && cmpResultPrimaryKey === -1) {
            continue;
          }
        }
        if (this._position !== void 0 && sourceIsObjectStore) {
          if (cmpResultPosition !== 1) {
            continue;
          }
        }
        if (this._position !== void 0 && !sourceIsObjectStore) {
          if (cmpResultPosition === -1) {
            continue;
          }
          if (cmpResultPosition === 0 && cmp_default(record.value, this._objectStorePosition) !== 1) {
            continue;
          }
        }
        if (this._range !== void 0) {
          if (!this._range.includes(record.key)) {
            continue;
          }
        }
        foundRecord = record;
        break;
      }
    } else if (this.direction === "nextunique") {
      const range = makeKeyRange(this._range, [key, this._position], []);
      for (const record of records.values(range)) {
        if (key !== void 0) {
          if (cmp_default(record.key, key) === -1) {
            continue;
          }
        }
        if (this._position !== void 0) {
          if (cmp_default(record.key, this._position) !== 1) {
            continue;
          }
        }
        if (this._range !== void 0) {
          if (!this._range.includes(record.key)) {
            continue;
          }
        }
        foundRecord = record;
        break;
      }
    } else if (this.direction === "prev") {
      const range = makeKeyRange(this._range, [], [key, this._position]);
      for (const record of records.values(range, "prev")) {
        const cmpResultKey = key !== void 0 ? cmp_default(record.key, key) : void 0;
        const cmpResultPosition = this._position !== void 0 ? cmp_default(record.key, this._position) : void 0;
        if (key !== void 0) {
          if (cmpResultKey === 1) {
            continue;
          }
        }
        if (primaryKey !== void 0) {
          if (cmpResultKey === 1) {
            continue;
          }
          const cmpResultPrimaryKey = cmp_default(record.value, primaryKey);
          if (cmpResultKey === 0 && cmpResultPrimaryKey === 1) {
            continue;
          }
        }
        if (this._position !== void 0 && sourceIsObjectStore) {
          if (cmpResultPosition !== -1) {
            continue;
          }
        }
        if (this._position !== void 0 && !sourceIsObjectStore) {
          if (cmpResultPosition === 1) {
            continue;
          }
          if (cmpResultPosition === 0 && cmp_default(record.value, this._objectStorePosition) !== -1) {
            continue;
          }
        }
        if (this._range !== void 0) {
          if (!this._range.includes(record.key)) {
            continue;
          }
        }
        foundRecord = record;
        break;
      }
    } else if (this.direction === "prevunique") {
      let tempRecord;
      const range = makeKeyRange(this._range, [], [key, this._position]);
      for (const record of records.values(range, "prev")) {
        if (key !== void 0) {
          if (cmp_default(record.key, key) === 1) {
            continue;
          }
        }
        if (this._position !== void 0) {
          if (cmp_default(record.key, this._position) !== -1) {
            continue;
          }
        }
        if (this._range !== void 0) {
          if (!this._range.includes(record.key)) {
            continue;
          }
        }
        tempRecord = record;
        break;
      }
      if (tempRecord) {
        foundRecord = records.get(tempRecord.key);
      }
    }
    let result;
    if (!foundRecord) {
      this._key = void 0;
      if (!sourceIsObjectStore) {
        this._objectStorePosition = void 0;
      }
      if (!this._keyOnly && this.toString() === "[object IDBCursorWithValue]") {
        this.value = void 0;
      }
      result = null;
    } else {
      this._position = foundRecord.key;
      if (!sourceIsObjectStore) {
        this._objectStorePosition = foundRecord.value;
      }
      this._key = foundRecord.key;
      if (sourceIsObjectStore) {
        this._primaryKey = structuredClone(foundRecord.key);
        if (!this._keyOnly && this.toString() === "[object IDBCursorWithValue]") {
          this.value = structuredClone(foundRecord.value);
        }
      } else {
        this._primaryKey = structuredClone(foundRecord.value);
        if (!this._keyOnly && this.toString() === "[object IDBCursorWithValue]") {
          if (this.source instanceof FDBObjectStore_default) {
            throw new Error("This should never happen");
          }
          const value = this.source.objectStore._rawObjectStore.getValue(foundRecord.value);
          this.value = structuredClone(value);
        }
      }
      this._gotValue = true;
      result = this;
    }
    return result;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBCursor-update-IDBRequest-any-value
  update(value) {
    if (value === void 0) {
      throw new TypeError();
    }
    const effectiveObjectStore = getEffectiveObjectStore(this);
    const effectiveKey = Object.hasOwn(this.source, "_rawIndex") ? this.primaryKey : this._position;
    const transaction = effectiveObjectStore.transaction;
    if (transaction._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (transaction.mode === "readonly") {
      throw new ReadOnlyError();
    }
    if (effectiveObjectStore._rawObjectStore.deleted) {
      throw new InvalidStateError();
    }
    if (!(this.source instanceof FDBObjectStore_default) && this.source._rawIndex.deleted) {
      throw new InvalidStateError();
    }
    if (!this._gotValue || !Object.hasOwn(this, "value")) {
      throw new InvalidStateError();
    }
    const clone = cloneValueForInsertion(value, transaction);
    if (effectiveObjectStore.keyPath !== null) {
      let tempKey;
      try {
        tempKey = extractKey_default(effectiveObjectStore.keyPath, clone).key;
      } catch (err) {
      }
      if (cmp_default(tempKey, effectiveKey) !== 0) {
        throw new DataError();
      }
    }
    const record = {
      key: effectiveKey,
      value: clone
    };
    return transaction._execRequestAsync({
      operation: effectiveObjectStore._rawObjectStore.storeRecord.bind(effectiveObjectStore._rawObjectStore, record, false, transaction._rollbackLog),
      source: this
    });
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBCursor-advance-void-unsigned-long-count
  advance(count) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new TypeError();
    }
    const effectiveObjectStore = getEffectiveObjectStore(this);
    const transaction = effectiveObjectStore.transaction;
    if (transaction._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (effectiveObjectStore._rawObjectStore.deleted) {
      throw new InvalidStateError();
    }
    if (!(this.source instanceof FDBObjectStore_default) && this.source._rawIndex.deleted) {
      throw new InvalidStateError();
    }
    if (!this._gotValue) {
      throw new InvalidStateError();
    }
    if (this._request) {
      this._request.readyState = "pending";
    }
    transaction._execRequestAsync({
      operation: () => {
        let result;
        for (let i = 0; i < count; i++) {
          result = this._iterate();
          if (!result) {
            break;
          }
        }
        return result;
      },
      request: this._request,
      source: this.source
    });
    this._gotValue = false;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBCursor-continue-void-any-key
  continue(key) {
    const effectiveObjectStore = getEffectiveObjectStore(this);
    const transaction = effectiveObjectStore.transaction;
    if (transaction._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (effectiveObjectStore._rawObjectStore.deleted) {
      throw new InvalidStateError();
    }
    if (!(this.source instanceof FDBObjectStore_default) && this.source._rawIndex.deleted) {
      throw new InvalidStateError();
    }
    if (!this._gotValue) {
      throw new InvalidStateError();
    }
    if (key !== void 0) {
      key = valueToKey_default(key);
      const cmpResult = cmp_default(key, this._position);
      if (cmpResult <= 0 && (this.direction === "next" || this.direction === "nextunique") || cmpResult >= 0 && (this.direction === "prev" || this.direction === "prevunique")) {
        throw new DataError();
      }
    }
    if (this._request) {
      this._request.readyState = "pending";
    }
    transaction._execRequestAsync({
      operation: this._iterate.bind(this, key),
      request: this._request,
      source: this.source
    });
    this._gotValue = false;
  }
  // hthttps://w3c.github.io/IndexedDB/#dom-idbcursor-continueprimarykey
  continuePrimaryKey(key, primaryKey) {
    const effectiveObjectStore = getEffectiveObjectStore(this);
    const transaction = effectiveObjectStore.transaction;
    if (transaction._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (effectiveObjectStore._rawObjectStore.deleted) {
      throw new InvalidStateError();
    }
    if (!(this.source instanceof FDBObjectStore_default) && this.source._rawIndex.deleted) {
      throw new InvalidStateError();
    }
    if (this.source instanceof FDBObjectStore_default || this.direction !== "next" && this.direction !== "prev") {
      throw new InvalidAccessError();
    }
    if (!this._gotValue) {
      throw new InvalidStateError();
    }
    if (key === void 0 || primaryKey === void 0) {
      throw new DataError();
    }
    key = valueToKey_default(key);
    const cmpResult = cmp_default(key, this._position);
    if (cmpResult === -1 && this.direction === "next" || cmpResult === 1 && this.direction === "prev") {
      throw new DataError();
    }
    const cmpResult2 = cmp_default(primaryKey, this._objectStorePosition);
    if (cmpResult === 0) {
      if (cmpResult2 <= 0 && this.direction === "next" || cmpResult2 >= 0 && this.direction === "prev") {
        throw new DataError();
      }
    }
    if (this._request) {
      this._request.readyState = "pending";
    }
    transaction._execRequestAsync({
      operation: this._iterate.bind(this, key, primaryKey),
      request: this._request,
      source: this.source
    });
    this._gotValue = false;
  }
  delete() {
    const effectiveObjectStore = getEffectiveObjectStore(this);
    const effectiveKey = Object.hasOwn(this.source, "_rawIndex") ? this.primaryKey : this._position;
    const transaction = effectiveObjectStore.transaction;
    if (transaction._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (transaction.mode === "readonly") {
      throw new ReadOnlyError();
    }
    if (effectiveObjectStore._rawObjectStore.deleted) {
      throw new InvalidStateError();
    }
    if (!(this.source instanceof FDBObjectStore_default) && this.source._rawIndex.deleted) {
      throw new InvalidStateError();
    }
    if (!this._gotValue || !Object.hasOwn(this, "value")) {
      throw new InvalidStateError();
    }
    return transaction._execRequestAsync({
      operation: effectiveObjectStore._rawObjectStore.deleteRecord.bind(effectiveObjectStore._rawObjectStore, effectiveKey, transaction._rollbackLog),
      source: this
    });
  }
  get [Symbol.toStringTag]() {
    return "IDBCursor";
  }
};
var FDBCursor_default = FDBCursor;

// node_modules/fake-indexeddb/build/esm/FDBCursorWithValue.js
var FDBCursorWithValue = class extends FDBCursor_default {
  value = void 0;
  constructor(source, range, direction, request) {
    super(source, range, direction, request);
  }
  get [Symbol.toStringTag]() {
    return "IDBCursorWithValue";
  }
};
var FDBCursorWithValue_default = FDBCursorWithValue;

// node_modules/fake-indexeddb/build/esm/lib/FakeEventTarget.js
var stopped = (event, listener) => {
  return event.immediatePropagationStopped || event.eventPhase === event.CAPTURING_PHASE && listener.capture === false || event.eventPhase === event.BUBBLING_PHASE && listener.capture === true;
};
var invokeEventListeners = (event, obj) => {
  event.currentTarget = obj;
  const errors = [];
  const invoke = (callback2) => {
    try {
      callback2.call(event.currentTarget, event);
    } catch (err) {
      errors.push(err);
    }
  };
  for (const listener of obj.listeners.slice()) {
    if (event.type !== listener.type || stopped(event, listener)) {
      continue;
    }
    invoke(listener.callback);
  }
  const typeToProp = {
    abort: "onabort",
    blocked: "onblocked",
    close: "onclose",
    complete: "oncomplete",
    error: "onerror",
    success: "onsuccess",
    upgradeneeded: "onupgradeneeded",
    versionchange: "onversionchange"
  };
  const prop = typeToProp[event.type];
  if (prop === void 0) {
    throw new Error(`Unknown event type: "${event.type}"`);
  }
  const callback = event.currentTarget[prop];
  if (callback) {
    const listener = {
      callback,
      capture: false,
      type: event.type
    };
    if (!stopped(event, listener)) {
      invoke(listener.callback);
    }
  }
  if (errors.length) {
    throw new AggregateError(errors);
  }
};
var FakeEventTarget = class {
  listeners = [];
  // These will be overridden in individual subclasses and made not readonly
  addEventListener(type, callback, capture = false) {
    this.listeners.push({
      callback,
      capture,
      type
    });
  }
  removeEventListener(type, callback, capture = false) {
    const i = this.listeners.findIndex((listener) => {
      return listener.type === type && listener.callback === callback && listener.capture === capture;
    });
    this.listeners.splice(i, 1);
  }
  // http://www.w3.org/TR/dom/#dispatching-events
  dispatchEvent(event) {
    if (event.dispatched || !event.initialized) {
      throw new InvalidStateError("The object is in an invalid state.");
    }
    event.isTrusted = false;
    event.dispatched = true;
    event.target = this;
    event.eventPhase = event.CAPTURING_PHASE;
    for (const obj of event.eventPath) {
      if (!event.propagationStopped) {
        invokeEventListeners(event, obj);
      }
    }
    event.eventPhase = event.AT_TARGET;
    if (!event.propagationStopped) {
      invokeEventListeners(event, event.target);
    }
    if (event.bubbles) {
      event.eventPath.reverse();
      event.eventPhase = event.BUBBLING_PHASE;
      for (const obj of event.eventPath) {
        if (!event.propagationStopped) {
          invokeEventListeners(event, obj);
        }
      }
    }
    event.dispatched = false;
    event.eventPhase = event.NONE;
    event.currentTarget = null;
    if (event.canceled) {
      return false;
    }
    return true;
  }
};
var FakeEventTarget_default = FakeEventTarget;

// node_modules/fake-indexeddb/build/esm/FDBRequest.js
var FDBRequest = class extends FakeEventTarget_default {
  _result = null;
  _error = null;
  source = null;
  transaction = null;
  readyState = "pending";
  onsuccess = null;
  onerror = null;
  get error() {
    if (this.readyState === "pending") {
      throw new InvalidStateError();
    }
    return this._error;
  }
  set error(value) {
    this._error = value;
  }
  get result() {
    if (this.readyState === "pending") {
      throw new InvalidStateError();
    }
    return this._result;
  }
  set result(value) {
    this._result = value;
  }
  get [Symbol.toStringTag]() {
    return "IDBRequest";
  }
};
var FDBRequest_default = FDBRequest;

// node_modules/fake-indexeddb/build/esm/lib/FakeDOMStringList.js
var FakeDOMStringList = class {
  constructor(...values) {
    this._values = values;
    for (let i = 0; i < values.length; i++) {
      this[i] = values[i];
    }
  }
  contains(value) {
    return this._values.includes(value);
  }
  item(i) {
    if (i < 0 || i >= this._values.length) {
      return null;
    }
    return this._values[i];
  }
  get length() {
    return this._values.length;
  }
  [Symbol.iterator]() {
    return this._values[Symbol.iterator]();
  }
  // Handled by proxy
  // Used internally, should not be used by others. I could maybe get rid of these and replace rather than mutate, but too lazy to check the spec.
  _push(...values) {
    for (let i = 0; i < values.length; i++) {
      this[this._values.length + i] = values[i];
    }
    this._values.push(...values);
  }
  _sort(...values) {
    this._values.sort(...values);
    for (let i = 0; i < this._values.length; i++) {
      this[i] = this._values[i];
    }
    return this;
  }
};
var FakeDOMStringList_default = FakeDOMStringList;

// node_modules/fake-indexeddb/build/esm/lib/valueToKeyRange.js
var valueToKeyRange = (value, nullDisallowedFlag = false) => {
  if (value instanceof FDBKeyRange_default) {
    return value;
  }
  if (value === null || value === void 0) {
    if (nullDisallowedFlag) {
      throw new DataError();
    }
    return new FDBKeyRange_default(void 0, void 0, false, false);
  }
  const key = valueToKey_default(value);
  return FDBKeyRange_default.only(key);
};
var valueToKeyRange_default = valueToKeyRange;

// node_modules/fake-indexeddb/build/esm/lib/getKeyPath.js
var convertKey = (key) => typeof key === "object" && key ? key + "" : key;
function getKeyPath(keyPath) {
  return Array.isArray(keyPath) ? keyPath.map(convertKey) : convertKey(keyPath);
}

// node_modules/fake-indexeddb/build/esm/lib/isPotentiallyValidKeyRange.js
var isPotentiallyValidKeyRange = (value) => {
  if (value instanceof FDBKeyRange_default) {
    return true;
  }
  const key = valueToKeyWithoutThrowing_default(value);
  return key !== INVALID_TYPE;
};
var isPotentiallyValidKeyRange_default = isPotentiallyValidKeyRange;

// node_modules/fake-indexeddb/build/esm/lib/enforceRange.js
var enforceRange = (num, type) => {
  const min = 0;
  const max = type === "unsigned long" ? 4294967295 : 9007199254740991;
  if (isNaN(num) || num < min || num > max) {
    throw new TypeError();
  }
  if (num >= 0) {
    return Math.floor(num);
  }
};
var enforceRange_default = enforceRange;

// node_modules/fake-indexeddb/build/esm/lib/extractGetAllOptions.js
var extractGetAllOptions = (queryOrOptions, count, numArguments) => {
  let query;
  let direction;
  if (queryOrOptions === void 0 || queryOrOptions === null || isPotentiallyValidKeyRange_default(queryOrOptions)) {
    query = queryOrOptions;
    if (numArguments > 1 && count !== void 0) {
      count = enforceRange_default(count, "unsigned long");
    }
  } else {
    const getAllOptions = queryOrOptions;
    if (getAllOptions.query !== void 0) {
      query = getAllOptions.query;
    }
    if (getAllOptions.count !== void 0) {
      count = enforceRange_default(getAllOptions.count, "unsigned long");
    }
    if (getAllOptions.direction !== void 0) {
      direction = getAllOptions.direction;
    }
  }
  return {
    query,
    count,
    direction
  };
};
var extractGetAllOptions_default = extractGetAllOptions;

// node_modules/fake-indexeddb/build/esm/FDBIndex.js
var confirmActiveTransaction = (index) => {
  if (index._rawIndex.deleted || index.objectStore._rawObjectStore.deleted) {
    throw new InvalidStateError();
  }
  if (index.objectStore.transaction._state !== "active") {
    throw new TransactionInactiveError();
  }
};
var FDBIndex = class {
  constructor(objectStore, rawIndex) {
    this._rawIndex = rawIndex;
    this._name = rawIndex.name;
    this.objectStore = objectStore;
    this.keyPath = getKeyPath(rawIndex.keyPath);
    this.multiEntry = rawIndex.multiEntry;
    this.unique = rawIndex.unique;
  }
  get name() {
    return this._name;
  }
  // https://w3c.github.io/IndexedDB/#dom-idbindex-name
  set name(name) {
    const transaction = this.objectStore.transaction;
    if (!transaction.db._runningVersionchangeTransaction) {
      throw transaction._state === "active" ? new InvalidStateError() : new TransactionInactiveError();
    }
    if (transaction._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (this._rawIndex.deleted || this.objectStore._rawObjectStore.deleted) {
      throw new InvalidStateError();
    }
    name = String(name);
    if (name === this._name) {
      return;
    }
    if (this.objectStore.indexNames.contains(name)) {
      throw new ConstraintError();
    }
    const oldName = this._name;
    const oldIndexNames = [...this.objectStore.indexNames];
    this._name = name;
    this._rawIndex.name = name;
    this.objectStore._indexesCache.delete(oldName);
    this.objectStore._indexesCache.set(name, this);
    this.objectStore._rawObjectStore.rawIndexes.delete(oldName);
    this.objectStore._rawObjectStore.rawIndexes.set(name, this._rawIndex);
    this.objectStore.indexNames = new FakeDOMStringList_default(...Array.from(this.objectStore._rawObjectStore.rawIndexes.keys()).filter((indexName) => {
      const index = this.objectStore._rawObjectStore.rawIndexes.get(indexName);
      return index && !index.deleted;
    }).sort());
    if (!this.objectStore.transaction._createdIndexes.has(this._rawIndex)) {
      transaction._rollbackLog.push(() => {
        this._name = oldName;
        this._rawIndex.name = oldName;
        this.objectStore._indexesCache.delete(name);
        this.objectStore._indexesCache.set(oldName, this);
        this.objectStore._rawObjectStore.rawIndexes.delete(name);
        this.objectStore._rawObjectStore.rawIndexes.set(oldName, this._rawIndex);
        this.objectStore.indexNames = new FakeDOMStringList_default(...oldIndexNames);
      });
    }
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBIndex-openCursor-IDBRequest-any-range-IDBCursorDirection-direction
  openCursor(range, direction) {
    confirmActiveTransaction(this);
    if (range === null) {
      range = void 0;
    }
    if (range !== void 0 && !(range instanceof FDBKeyRange_default)) {
      range = FDBKeyRange_default.only(valueToKey_default(range));
    }
    const request = new FDBRequest_default();
    request.source = this;
    request.transaction = this.objectStore.transaction;
    const cursor = new FDBCursorWithValue_default(this, range, direction, request);
    return this.objectStore.transaction._execRequestAsync({
      operation: cursor._iterate.bind(cursor),
      request,
      source: this
    });
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBIndex-openKeyCursor-IDBRequest-any-range-IDBCursorDirection-direction
  openKeyCursor(range, direction) {
    confirmActiveTransaction(this);
    if (range === null) {
      range = void 0;
    }
    if (range !== void 0 && !(range instanceof FDBKeyRange_default)) {
      range = FDBKeyRange_default.only(valueToKey_default(range));
    }
    const request = new FDBRequest_default();
    request.source = this;
    request.transaction = this.objectStore.transaction;
    const cursor = new FDBCursor_default(this, range, direction, request, true);
    return this.objectStore.transaction._execRequestAsync({
      operation: cursor._iterate.bind(cursor),
      request,
      source: this
    });
  }
  get(key) {
    confirmActiveTransaction(this);
    if (!(key instanceof FDBKeyRange_default)) {
      key = valueToKey_default(key);
    }
    return this.objectStore.transaction._execRequestAsync({
      operation: this._rawIndex.getValue.bind(this._rawIndex, key),
      source: this
    });
  }
  // http://w3c.github.io/IndexedDB/#dom-idbindex-getall
  getAll(queryOrOptions, count) {
    const options = extractGetAllOptions_default(queryOrOptions, count, arguments.length);
    confirmActiveTransaction(this);
    const range = valueToKeyRange_default(options.query);
    return this.objectStore.transaction._execRequestAsync({
      operation: this._rawIndex.getAllValues.bind(this._rawIndex, range, options.count, options.direction),
      source: this
    });
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBIndex-getKey-IDBRequest-any-key
  getKey(key) {
    confirmActiveTransaction(this);
    if (!(key instanceof FDBKeyRange_default)) {
      key = valueToKey_default(key);
    }
    return this.objectStore.transaction._execRequestAsync({
      operation: this._rawIndex.getKey.bind(this._rawIndex, key),
      source: this
    });
  }
  // http://w3c.github.io/IndexedDB/#dom-idbindex-getallkeys
  getAllKeys(queryOrOptions, count) {
    const options = extractGetAllOptions_default(queryOrOptions, count, arguments.length);
    confirmActiveTransaction(this);
    const range = valueToKeyRange_default(options.query);
    return this.objectStore.transaction._execRequestAsync({
      operation: this._rawIndex.getAllKeys.bind(this._rawIndex, range, options.count, options.direction),
      source: this
    });
  }
  // https://www.w3.org/TR/IndexedDB/#dom-idbobjectstore-getallrecords
  getAllRecords(options) {
    let query;
    let count;
    let direction;
    if (options !== void 0) {
      if (options.query !== void 0) {
        query = options.query;
      }
      if (options.count !== void 0) {
        count = enforceRange_default(options.count, "unsigned long");
      }
      if (options.direction !== void 0) {
        direction = options.direction;
      }
    }
    confirmActiveTransaction(this);
    const range = valueToKeyRange_default(query);
    return this.objectStore.transaction._execRequestAsync({
      operation: this._rawIndex.getAllRecords.bind(this._rawIndex, range, count, direction),
      source: this
    });
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBIndex-count-IDBRequest-any-key
  count(key) {
    confirmActiveTransaction(this);
    if (key === null) {
      key = void 0;
    }
    if (key !== void 0 && !(key instanceof FDBKeyRange_default)) {
      key = FDBKeyRange_default.only(valueToKey_default(key));
    }
    return this.objectStore.transaction._execRequestAsync({
      operation: () => {
        return this._rawIndex.count(key);
      },
      source: this
    });
  }
  get [Symbol.toStringTag]() {
    return "IDBIndex";
  }
};
var FDBIndex_default = FDBIndex;

// node_modules/fake-indexeddb/build/esm/lib/canInjectKey.js
var canInjectKey = (keyPath, value) => {
  if (Array.isArray(keyPath)) {
    throw new Error("The key paths used in this section are always strings and never sequences, since it is not possible to create a object store which has a key generator and also has a key path that is a sequence.");
  }
  const identifiers = keyPath.split(".");
  if (identifiers.length === 0) {
    throw new Error("Assert: identifiers is not empty");
  }
  identifiers.pop();
  for (const identifier of identifiers) {
    if (typeof value !== "object" && !Array.isArray(value)) {
      return false;
    }
    const hop = Object.hasOwn(value, identifier);
    if (!hop) {
      return true;
    }
    value = value[identifier];
  }
  return typeof value === "object" || Array.isArray(value);
};
var canInjectKey_default = canInjectKey;

// node_modules/fake-indexeddb/build/esm/FDBRecord.js
var FDBRecord = class {
  constructor(key, primaryKey, value) {
    this._key = key;
    this._primaryKey = primaryKey;
    this._value = value;
  }
  get key() {
    return this._key;
  }
  set key(_) {
  }
  get primaryKey() {
    return this._primaryKey;
  }
  set primaryKey(_) {
  }
  get value() {
    return this._value;
  }
  set value(_) {
  }
  get [Symbol.toStringTag]() {
    return "IDBRecord";
  }
};
var FDBRecord_default = FDBRecord;

// node_modules/fake-indexeddb/build/esm/lib/binarySearchTree.js
var MAX_TOMBSTONE_FACTOR = 2 / 3;
var EVERYTHING_KEY_RANGE = new FDBKeyRange_default(void 0, void 0, false, false);
var BinarySearchTree = class {
  _numTombstones = 0;
  _numNodes = 0;
  /**
   *
   * @param keysAreUnique - whether keys can be unique, and thus whether we cn skip checking `record.value` when
   * comparing. This is basically used to distinguish ObjectStores (where the value is the entire object, not used
   * as a key) from non-unique Indexes (where both the key and the value are meaningful keys used for sorting)
   */
  constructor(keysAreUnique) {
    this._keysAreUnique = !!keysAreUnique;
  }
  size() {
    return this._numNodes - this._numTombstones;
  }
  get(record) {
    return this._getByComparator(this._root, (otherRecord) => this._compare(record, otherRecord));
  }
  contains(record) {
    return !!this.get(record);
  }
  _compare(a, b) {
    const keyComparison = cmp_default(a.key, b.key);
    if (keyComparison !== 0) {
      return keyComparison;
    }
    return this._keysAreUnique ? 0 : cmp_default(a.value, b.value);
  }
  _getByComparator(node, comparator) {
    let current = node;
    while (current) {
      const comparison = comparator(current.record);
      if (comparison < 0) {
        current = current.left;
      } else if (comparison > 0) {
        current = current.right;
      } else {
        return current.record;
      }
    }
  }
  /**
   * Put a new record, and return the overwritten record if an overwrite occurred.
   * @param record
   * @param noOverwrite - throw a ConstraintError in case of overwrite
   */
  put(record, noOverwrite = false) {
    if (!this._root) {
      this._root = {
        record,
        left: void 0,
        right: void 0,
        parent: void 0,
        deleted: false,
        // the root is always black in a red-black tree
        red: false
      };
      this._numNodes++;
      return;
    }
    return this._put(this._root, record, noOverwrite);
  }
  _put(node, record, noOverwrite) {
    const comparison = this._compare(record, node.record);
    if (comparison < 0) {
      if (node.left) {
        return this._put(node.left, record, noOverwrite);
      } else {
        node.left = {
          record,
          left: void 0,
          right: void 0,
          parent: node,
          deleted: false,
          red: true
        };
        this._onNewNodeInserted(node.left);
      }
    } else if (comparison > 0) {
      if (node.right) {
        return this._put(node.right, record, noOverwrite);
      } else {
        node.right = {
          record,
          left: void 0,
          right: void 0,
          parent: node,
          deleted: false,
          red: true
        };
        this._onNewNodeInserted(node.right);
      }
    } else if (node.deleted) {
      node.deleted = false;
      node.record = record;
      this._numTombstones--;
    } else if (noOverwrite) {
      throw new ConstraintError();
    } else {
      const overwrittenRecord = node.record;
      node.record = record;
      return overwrittenRecord;
    }
  }
  delete(record) {
    if (!this._root) {
      return;
    }
    this._delete(this._root, record);
    if (this._numTombstones > this._numNodes * MAX_TOMBSTONE_FACTOR) {
      const records = [...this.getAllRecords()];
      this._root = this._rebuild(records, void 0, false);
      this._numNodes = records.length;
      this._numTombstones = 0;
    }
  }
  _delete(node, record) {
    if (!node) {
      return;
    }
    const comparison = this._compare(record, node.record);
    if (comparison < 0) {
      this._delete(node.left, record);
    } else if (comparison > 0) {
      this._delete(node.right, record);
    } else if (!node.deleted) {
      this._numTombstones++;
      node.deleted = true;
    }
  }
  *getAllRecords(descending = false) {
    yield* this.getRecords(EVERYTHING_KEY_RANGE, descending);
  }
  *getRecords(keyRange, descending = false) {
    yield* this._getRecordsForNode(this._root, keyRange, descending);
  }
  *_getRecordsForNode(node, keyRange, descending = false) {
    if (!node) {
      return;
    }
    yield* this._findRecords(node, keyRange, descending);
  }
  *_findRecords(node, keyRange, descending = false) {
    const {
      lower,
      upper,
      lowerOpen,
      upperOpen
    } = keyRange;
    const {
      record: {
        key
      }
    } = node;
    const lowerComparison = lower === void 0 ? -1 : cmp_default(lower, key);
    const upperComparison = upper === void 0 ? 1 : cmp_default(upper, key);
    const moreLeft = this._keysAreUnique ? lowerComparison < 0 : lowerComparison <= 0;
    const moreRight = this._keysAreUnique ? upperComparison > 0 : upperComparison >= 0;
    const moreStart = descending ? moreRight : moreLeft;
    const moreEnd = descending ? moreLeft : moreRight;
    const start = descending ? "right" : "left";
    const end = descending ? "left" : "right";
    const lowerMatches = lowerOpen ? lowerComparison < 0 : lowerComparison <= 0;
    const upperMatches = upperOpen ? upperComparison > 0 : upperComparison >= 0;
    if (moreStart && node[start]) {
      yield* this._findRecords(node[start], keyRange, descending);
    }
    if (lowerMatches && upperMatches && !node.deleted) {
      yield node.record;
    }
    if (moreEnd && node[end]) {
      yield* this._findRecords(node[end], keyRange, descending);
    }
  }
  _onNewNodeInserted(newNode) {
    this._numNodes++;
    this._rebalanceTree(newNode);
  }
  // based on https://en.wikipedia.org/wiki/Red%E2%80%93black_tree#Insertion
  _rebalanceTree(node) {
    let parent = node.parent;
    do {
      if (!parent.red) {
        return;
      }
      const grandparent = parent.parent;
      if (!grandparent) {
        parent.red = false;
        return;
      }
      const parentIsRightChild = parent === grandparent.right;
      const uncle = parentIsRightChild ? grandparent.left : grandparent.right;
      if (!uncle || !uncle.red) {
        if (node === (parentIsRightChild ? parent.left : parent.right)) {
          this._rotateSubtree(parent, parentIsRightChild);
          node = parent;
          parent = parentIsRightChild ? grandparent.right : grandparent.left;
        }
        this._rotateSubtree(grandparent, !parentIsRightChild);
        parent.red = false;
        grandparent.red = true;
        return;
      }
      parent.red = false;
      uncle.red = false;
      grandparent.red = true;
      node = grandparent;
    } while (node.parent ? parent = node.parent : false);
  }
  // based on https://en.wikipedia.org/wiki/Red%E2%80%93black_tree#Implementation
  _rotateSubtree(node, right) {
    const parent = node.parent;
    const newRoot = right ? node.left : node.right;
    const newChild = right ? newRoot.right : newRoot.left;
    node[right ? "left" : "right"] = newChild;
    if (newChild) {
      newChild.parent = node;
    }
    newRoot[right ? "right" : "left"] = node;
    newRoot.parent = parent;
    node.parent = newRoot;
    if (parent) {
      parent[node === parent.right ? "right" : "left"] = newRoot;
    } else {
      this._root = newRoot;
    }
    return newRoot;
  }
  // rebuild the whole tree from scratch, used to avoid too many deletion tombstones accumulating
  _rebuild(records, parent, red) {
    const {
      length
    } = records;
    if (!length) {
      return void 0;
    }
    const mid = length >>> 1;
    const node = {
      record: records[mid],
      left: void 0,
      right: void 0,
      parent,
      deleted: false,
      red
    };
    const left = this._rebuild(records.slice(0, mid), node, !red);
    const right = this._rebuild(records.slice(mid + 1), node, !red);
    node.left = left;
    node.right = right;
    return node;
  }
};

// node_modules/fake-indexeddb/build/esm/lib/RecordStore.js
var RecordStore = class {
  constructor(keysAreUnique) {
    this.keysAreUnique = keysAreUnique;
    this.records = new BinarySearchTree(this.keysAreUnique);
  }
  get(key) {
    const range = key instanceof FDBKeyRange_default ? key : FDBKeyRange_default.only(key);
    return this.records.getRecords(range).next().value;
  }
  /**
   * Put a new record, and return the overwritten record if an overwrite occurred.
   * @param newRecord
   * @param noOverwrite - throw a ConstraintError in case of overwrite
   */
  put(newRecord, noOverwrite = false) {
    return this.records.put(newRecord, noOverwrite);
  }
  delete(key) {
    const range = key instanceof FDBKeyRange_default ? key : FDBKeyRange_default.only(key);
    const deletedRecords = [...this.records.getRecords(range)];
    for (const record of deletedRecords) {
      this.records.delete(record);
    }
    return deletedRecords;
  }
  deleteByValue(key) {
    const range = key instanceof FDBKeyRange_default ? key : FDBKeyRange_default.only(key);
    const deletedRecords = [];
    for (const record of this.records.getAllRecords()) {
      if (range.includes(record.value)) {
        this.records.delete(record);
        deletedRecords.push(record);
      }
    }
    return deletedRecords;
  }
  clear() {
    const deletedRecords = [...this.records.getAllRecords()];
    this.records = new BinarySearchTree(this.keysAreUnique);
    return deletedRecords;
  }
  values(range, direction = "next") {
    const descending = direction === "prev" || direction === "prevunique";
    const records = range ? this.records.getRecords(range, descending) : this.records.getAllRecords(descending);
    return {
      [Symbol.iterator]: () => {
        const next = () => {
          return records.next();
        };
        if (direction === "next" || direction === "prev") {
          return {
            next
          };
        }
        if (direction === "nextunique") {
          let previousValue = void 0;
          return {
            next: () => {
              let current2 = next();
              while (!current2.done && previousValue !== void 0 && cmp_default(previousValue.key, current2.value.key) === 0) {
                current2 = next();
              }
              previousValue = current2.value;
              return current2;
            }
          };
        }
        let current = next();
        let nextResult = next();
        return {
          next: () => {
            while (!nextResult.done && cmp_default(current.value.key, nextResult.value.key) === 0) {
              current = nextResult;
              nextResult = next();
            }
            const result = current;
            current = nextResult;
            nextResult = next();
            return result;
          }
        };
      }
    };
  }
  size() {
    return this.records.size();
  }
};
var RecordStore_default = RecordStore;

// node_modules/fake-indexeddb/build/esm/lib/Index.js
var Index = class {
  deleted = false;
  // Initialized should be used to decide whether to throw an error or abort the versionchange transaction when there is a
  // constraint
  initialized = false;
  constructor(rawObjectStore, name, keyPath, multiEntry, unique) {
    this.rawObjectStore = rawObjectStore;
    this.name = name;
    this.keyPath = keyPath;
    this.multiEntry = multiEntry;
    this.unique = unique;
    this.records = new RecordStore_default(unique);
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-retrieving-a-value-from-an-index
  getKey(key) {
    const record = this.records.get(key);
    return record !== void 0 ? record.value : void 0;
  }
  // http://w3c.github.io/IndexedDB/#retrieve-multiple-referenced-values-from-an-index
  getAllKeys(range, count, direction) {
    if (count === void 0 || count === 0) {
      count = Infinity;
    }
    const records = [];
    for (const record of this.records.values(range, direction)) {
      records.push(structuredClone(record.value));
      if (records.length >= count) {
        break;
      }
    }
    return records;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#index-referenced-value-retrieval-operation
  getValue(key) {
    const record = this.records.get(key);
    return record !== void 0 ? this.rawObjectStore.getValue(record.value) : void 0;
  }
  // http://w3c.github.io/IndexedDB/#retrieve-multiple-referenced-values-from-an-index
  getAllValues(range, count, direction) {
    if (count === void 0 || count === 0) {
      count = Infinity;
    }
    const records = [];
    for (const record of this.records.values(range, direction)) {
      records.push(this.rawObjectStore.getValue(record.value));
      if (records.length >= count) {
        break;
      }
    }
    return records;
  }
  // https://www.w3.org/TR/IndexedDB/#dom-idbindex-getallrecords
  getAllRecords(range, count, direction) {
    if (count === void 0 || count === 0) {
      count = Infinity;
    }
    const records = [];
    for (const record of this.records.values(range, direction)) {
      records.push(new FDBRecord_default(structuredClone(record.key), structuredClone(this.rawObjectStore.getKey(record.value)), this.rawObjectStore.getValue(record.value)));
      if (records.length >= count) {
        break;
      }
    }
    return records;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-storing-a-record-into-an-object-store (step 7)
  storeRecord(newRecord) {
    let indexKey;
    try {
      indexKey = extractKey_default(this.keyPath, newRecord.value).key;
    } catch (err) {
      if (err.name === "DataError") {
        return;
      }
      throw err;
    }
    if (!this.multiEntry || !Array.isArray(indexKey)) {
      try {
        valueToKey_default(indexKey);
      } catch (e) {
        return;
      }
    } else {
      const keep = [];
      for (const part of indexKey) {
        if (keep.indexOf(part) < 0) {
          try {
            keep.push(valueToKey_default(part));
          } catch (err) {
          }
        }
      }
      indexKey = keep;
    }
    if (!this.multiEntry || !Array.isArray(indexKey)) {
      if (this.unique) {
        const existingRecord = this.records.get(indexKey);
        if (existingRecord) {
          throw new ConstraintError();
        }
      }
    } else {
      if (this.unique) {
        for (const individualIndexKey of indexKey) {
          const existingRecord = this.records.get(individualIndexKey);
          if (existingRecord) {
            throw new ConstraintError();
          }
        }
      }
    }
    if (!this.multiEntry || !Array.isArray(indexKey)) {
      this.records.put({
        key: indexKey,
        value: newRecord.key
      });
    } else {
      for (const individualIndexKey of indexKey) {
        this.records.put({
          key: individualIndexKey,
          value: newRecord.key
        });
      }
    }
  }
  initialize(transaction) {
    if (this.initialized) {
      throw new Error("Index already initialized");
    }
    transaction._execRequestAsync({
      operation: () => {
        try {
          for (const record of this.rawObjectStore.records.values()) {
            this.storeRecord(record);
          }
          this.initialized = true;
        } catch (err) {
          transaction._abort(err.name);
        }
      },
      source: null
    });
  }
  count(range) {
    let count = 0;
    for (const record of this.records.values(range)) {
      count += 1;
    }
    return count;
  }
};
var Index_default = Index;

// node_modules/fake-indexeddb/build/esm/lib/validateKeyPath.js
var validateKeyPath = (keyPath, parent) => {
  if (keyPath !== void 0 && keyPath !== null && typeof keyPath !== "string" && keyPath.toString && (parent === "array" || !Array.isArray(keyPath))) {
    keyPath = keyPath.toString();
  }
  if (typeof keyPath === "string") {
    if (keyPath === "" && parent !== "string") {
      return;
    }
    try {
      const validIdentifierRegex = (
        // eslint-disable-next-line no-misleading-character-class
        /^(?:[$A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0-\u08B2\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC])(?:[$0-9A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u052F\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0-\u08B2\u08E4-\u0963\u0966-\u096F\u0971-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C00-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D01-\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191E\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1AB0-\u1ABD\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1CF8\u1CF9\u1D00-\u1DF5\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA69D\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA7AD\uA7B0\uA7B1\uA7F7-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uA9E0-\uA9FE\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64\uAB65\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE2D\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC])*$/
      );
      if (keyPath.length >= 1 && validIdentifierRegex.test(keyPath)) {
        return;
      }
    } catch (err) {
      throw new SyntaxError(err.message);
    }
    if (keyPath.indexOf(" ") >= 0) {
      throw new SyntaxError("The keypath argument contains an invalid key path (no spaces allowed).");
    }
  }
  if (Array.isArray(keyPath) && keyPath.length > 0) {
    if (parent) {
      throw new SyntaxError("The keypath argument contains an invalid key path (nested arrays).");
    }
    for (const part of keyPath) {
      validateKeyPath(part, "array");
    }
    return;
  } else if (typeof keyPath === "string" && keyPath.indexOf(".") >= 0) {
    keyPath = keyPath.split(".");
    for (const part of keyPath) {
      validateKeyPath(part, "string");
    }
    return;
  }
  throw new SyntaxError();
};
var validateKeyPath_default = validateKeyPath;

// node_modules/fake-indexeddb/build/esm/FDBObjectStore.js
var confirmActiveTransaction2 = (objectStore) => {
  if (objectStore._rawObjectStore.deleted) {
    throw new InvalidStateError();
  }
  if (objectStore.transaction._state !== "active") {
    throw new TransactionInactiveError();
  }
};
var buildRecordAddPut = (objectStore, value, key) => {
  confirmActiveTransaction2(objectStore);
  if (objectStore.transaction.mode === "readonly") {
    throw new ReadOnlyError();
  }
  if (objectStore.keyPath !== null) {
    if (key !== void 0) {
      throw new DataError();
    }
  }
  const clone = cloneValueForInsertion(value, objectStore.transaction);
  if (objectStore.keyPath !== null) {
    const tempKey = extractKey_default(objectStore.keyPath, clone);
    if (tempKey.type === "found") {
      valueToKey_default(tempKey.key);
    } else {
      if (!objectStore._rawObjectStore.keyGenerator) {
        throw new DataError();
      } else if (!canInjectKey_default(objectStore.keyPath, clone)) {
        throw new DataError();
      }
    }
  }
  if (objectStore.keyPath === null && objectStore._rawObjectStore.keyGenerator === null && key === void 0) {
    throw new DataError();
  }
  if (key !== void 0) {
    key = valueToKey_default(key);
  }
  return {
    key,
    value: clone
  };
};
var FDBObjectStore = class {
  _indexesCache = /* @__PURE__ */ new Map();
  constructor(transaction, rawObjectStore) {
    this._rawObjectStore = rawObjectStore;
    this._name = rawObjectStore.name;
    this.keyPath = getKeyPath(rawObjectStore.keyPath);
    this.autoIncrement = rawObjectStore.autoIncrement;
    this.transaction = transaction;
    this.indexNames = new FakeDOMStringList_default(...Array.from(rawObjectStore.rawIndexes.keys()).sort());
  }
  get name() {
    return this._name;
  }
  // http://w3c.github.io/IndexedDB/#dom-idbobjectstore-name
  set name(name) {
    const transaction = this.transaction;
    if (!transaction.db._runningVersionchangeTransaction) {
      throw transaction._state === "active" ? new InvalidStateError() : new TransactionInactiveError();
    }
    confirmActiveTransaction2(this);
    name = String(name);
    if (name === this._name) {
      return;
    }
    if (this._rawObjectStore.rawDatabase.rawObjectStores.has(name)) {
      throw new ConstraintError();
    }
    const oldName = this._name;
    const oldObjectStoreNames = [...transaction.db.objectStoreNames];
    this._name = name;
    this._rawObjectStore.name = name;
    this.transaction._objectStoresCache.delete(oldName);
    this.transaction._objectStoresCache.set(name, this);
    this._rawObjectStore.rawDatabase.rawObjectStores.delete(oldName);
    this._rawObjectStore.rawDatabase.rawObjectStores.set(name, this._rawObjectStore);
    transaction.db.objectStoreNames = new FakeDOMStringList_default(...Array.from(this._rawObjectStore.rawDatabase.rawObjectStores.keys()).filter((objectStoreName) => {
      const objectStore = this._rawObjectStore.rawDatabase.rawObjectStores.get(objectStoreName);
      return objectStore && !objectStore.deleted;
    }).sort());
    const oldScope = new Set(transaction._scope);
    const oldTransactionObjectStoreNames = [...transaction.objectStoreNames];
    this.transaction._scope.delete(oldName);
    transaction._scope.add(name);
    transaction.objectStoreNames = new FakeDOMStringList_default(...Array.from(transaction._scope).sort());
    if (!this.transaction._createdObjectStores.has(this._rawObjectStore)) {
      transaction._rollbackLog.push(() => {
        this._name = oldName;
        this._rawObjectStore.name = oldName;
        this.transaction._objectStoresCache.delete(name);
        this.transaction._objectStoresCache.set(oldName, this);
        this._rawObjectStore.rawDatabase.rawObjectStores.delete(name);
        this._rawObjectStore.rawDatabase.rawObjectStores.set(oldName, this._rawObjectStore);
        transaction.db.objectStoreNames = new FakeDOMStringList_default(...oldObjectStoreNames);
        transaction._scope = oldScope;
        transaction.objectStoreNames = new FakeDOMStringList_default(...oldTransactionObjectStoreNames);
      });
    }
  }
  put(value, key) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    const record = buildRecordAddPut(this, value, key);
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.storeRecord.bind(this._rawObjectStore, record, false, this.transaction._rollbackLog),
      source: this
    });
  }
  add(value, key) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    const record = buildRecordAddPut(this, value, key);
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.storeRecord.bind(this._rawObjectStore, record, true, this.transaction._rollbackLog),
      source: this
    });
  }
  delete(key) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    confirmActiveTransaction2(this);
    if (this.transaction.mode === "readonly") {
      throw new ReadOnlyError();
    }
    if (!(key instanceof FDBKeyRange_default)) {
      key = valueToKey_default(key);
    }
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.deleteRecord.bind(this._rawObjectStore, key, this.transaction._rollbackLog),
      source: this
    });
  }
  get(key) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    confirmActiveTransaction2(this);
    if (!(key instanceof FDBKeyRange_default)) {
      key = valueToKey_default(key);
    }
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.getValue.bind(this._rawObjectStore, key),
      source: this
    });
  }
  // http://w3c.github.io/IndexedDB/#dom-idbobjectstore-getall
  getAll(queryOrOptions, count) {
    const options = extractGetAllOptions_default(queryOrOptions, count, arguments.length);
    confirmActiveTransaction2(this);
    const range = valueToKeyRange_default(options.query);
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.getAllValues.bind(this._rawObjectStore, range, options.count, options.direction),
      source: this
    });
  }
  // http://w3c.github.io/IndexedDB/#dom-idbobjectstore-getkey
  getKey(key) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    confirmActiveTransaction2(this);
    if (!(key instanceof FDBKeyRange_default)) {
      key = valueToKey_default(key);
    }
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.getKey.bind(this._rawObjectStore, key),
      source: this
    });
  }
  // http://w3c.github.io/IndexedDB/#dom-idbobjectstore-getallkeys
  getAllKeys(queryOrOptions, count) {
    const options = extractGetAllOptions_default(queryOrOptions, count, arguments.length);
    confirmActiveTransaction2(this);
    const range = valueToKeyRange_default(options.query);
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.getAllKeys.bind(this._rawObjectStore, range, options.count, options.direction),
      source: this
    });
  }
  // https://www.w3.org/TR/IndexedDB/#dom-idbobjectstore-getallrecords
  getAllRecords(options) {
    let query;
    let count;
    let direction;
    if (options !== void 0) {
      if (options.query !== void 0) {
        query = options.query;
      }
      if (options.count !== void 0) {
        count = enforceRange_default(options.count, "unsigned long");
      }
      if (options.direction !== void 0) {
        direction = options.direction;
      }
    }
    confirmActiveTransaction2(this);
    const range = valueToKeyRange_default(query);
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.getAllRecords.bind(this._rawObjectStore, range, count, direction),
      source: this
    });
  }
  clear() {
    confirmActiveTransaction2(this);
    if (this.transaction.mode === "readonly") {
      throw new ReadOnlyError();
    }
    return this.transaction._execRequestAsync({
      operation: this._rawObjectStore.clear.bind(this._rawObjectStore, this.transaction._rollbackLog),
      source: this
    });
  }
  openCursor(range, direction) {
    confirmActiveTransaction2(this);
    if (range === null) {
      range = void 0;
    }
    if (range !== void 0 && !(range instanceof FDBKeyRange_default)) {
      range = FDBKeyRange_default.only(valueToKey_default(range));
    }
    const request = new FDBRequest_default();
    request.source = this;
    request.transaction = this.transaction;
    const cursor = new FDBCursorWithValue_default(this, range, direction, request);
    return this.transaction._execRequestAsync({
      operation: cursor._iterate.bind(cursor),
      request,
      source: this
    });
  }
  openKeyCursor(range, direction) {
    confirmActiveTransaction2(this);
    if (range === null) {
      range = void 0;
    }
    if (range !== void 0 && !(range instanceof FDBKeyRange_default)) {
      range = FDBKeyRange_default.only(valueToKey_default(range));
    }
    const request = new FDBRequest_default();
    request.source = this;
    request.transaction = this.transaction;
    const cursor = new FDBCursor_default(this, range, direction, request, true);
    return this.transaction._execRequestAsync({
      operation: cursor._iterate.bind(cursor),
      request,
      source: this
    });
  }
  // tslint:-next-line max-line-length
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBObjectStore-createIndex-IDBIndex-DOMString-name-DOMString-sequence-DOMString--keyPath-IDBIndexParameters-optionalParameters
  createIndex(name, keyPath, optionalParameters = {}) {
    if (arguments.length < 2) {
      throw new TypeError();
    }
    const multiEntry = optionalParameters.multiEntry !== void 0 ? optionalParameters.multiEntry : false;
    const unique = optionalParameters.unique !== void 0 ? optionalParameters.unique : false;
    if (this.transaction.mode !== "versionchange") {
      throw new InvalidStateError();
    }
    confirmActiveTransaction2(this);
    if (this.indexNames.contains(name)) {
      throw new ConstraintError();
    }
    validateKeyPath_default(keyPath);
    if (Array.isArray(keyPath) && multiEntry) {
      throw new InvalidAccessError();
    }
    const indexNames = [...this.indexNames];
    const index = new Index_default(this._rawObjectStore, name, keyPath, multiEntry, unique);
    this.indexNames._push(name);
    this.indexNames._sort();
    this.transaction._createdIndexes.add(index);
    this._rawObjectStore.rawIndexes.set(name, index);
    index.initialize(this.transaction);
    this.transaction._rollbackLog.push(() => {
      index.deleted = true;
      this.indexNames = new FakeDOMStringList_default(...indexNames);
      this._rawObjectStore.rawIndexes.delete(index.name);
    });
    return new FDBIndex_default(this, index);
  }
  // https://w3c.github.io/IndexedDB/#dom-idbobjectstore-index
  index(name) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    if (this._rawObjectStore.deleted || this.transaction._state === "finished") {
      throw new InvalidStateError();
    }
    const index = this._indexesCache.get(name);
    if (index !== void 0) {
      return index;
    }
    const rawIndex = this._rawObjectStore.rawIndexes.get(name);
    if (!this.indexNames.contains(name) || rawIndex === void 0) {
      throw new NotFoundError();
    }
    const index2 = new FDBIndex_default(this, rawIndex);
    this._indexesCache.set(name, index2);
    return index2;
  }
  deleteIndex(name) {
    if (arguments.length === 0) {
      throw new TypeError();
    }
    if (this.transaction.mode !== "versionchange") {
      throw new InvalidStateError();
    }
    confirmActiveTransaction2(this);
    const rawIndex = this._rawObjectStore.rawIndexes.get(name);
    if (rawIndex === void 0) {
      throw new NotFoundError();
    }
    this.transaction._rollbackLog.push(() => {
      rawIndex.deleted = false;
      this._rawObjectStore.rawIndexes.set(rawIndex.name, rawIndex);
      this.indexNames._push(rawIndex.name);
      this.indexNames._sort();
    });
    this.indexNames = new FakeDOMStringList_default(...Array.from(this.indexNames).filter((indexName) => {
      return indexName !== name;
    }));
    rawIndex.deleted = true;
    this.transaction._execRequestAsync({
      operation: () => {
        const rawIndex2 = this._rawObjectStore.rawIndexes.get(name);
        if (rawIndex === rawIndex2) {
          this._rawObjectStore.rawIndexes.delete(name);
        }
      },
      source: this
    });
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBObjectStore-count-IDBRequest-any-key
  count(key) {
    confirmActiveTransaction2(this);
    if (key === null) {
      key = void 0;
    }
    if (key !== void 0 && !(key instanceof FDBKeyRange_default)) {
      key = FDBKeyRange_default.only(valueToKey_default(key));
    }
    return this.transaction._execRequestAsync({
      operation: () => {
        return this._rawObjectStore.count(key);
      },
      source: this
    });
  }
  get [Symbol.toStringTag]() {
    return "IDBObjectStore";
  }
};
var FDBObjectStore_default = FDBObjectStore;

// node_modules/fake-indexeddb/build/esm/lib/FakeEvent.js
var Event = class {
  eventPath = [];
  NONE = 0;
  CAPTURING_PHASE = 1;
  AT_TARGET = 2;
  BUBBLING_PHASE = 3;
  // Flags
  propagationStopped = false;
  immediatePropagationStopped = false;
  canceled = false;
  initialized = true;
  dispatched = false;
  target = null;
  currentTarget = null;
  eventPhase = 0;
  defaultPrevented = false;
  isTrusted = false;
  timeStamp = Date.now();
  constructor(type, eventInitDict = {}) {
    this.type = type;
    this.bubbles = eventInitDict.bubbles !== void 0 ? eventInitDict.bubbles : false;
    this.cancelable = eventInitDict.cancelable !== void 0 ? eventInitDict.cancelable : false;
  }
  preventDefault() {
    if (this.cancelable) {
      this.canceled = true;
    }
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
  stopImmediatePropagation() {
    this.propagationStopped = true;
    this.immediatePropagationStopped = true;
  }
};
var FakeEvent_default = Event;

// node_modules/fake-indexeddb/build/esm/lib/scheduling.js
function getSetImmediateFromJsdom() {
  if (typeof navigator !== "undefined" && /jsdom/.test(navigator.userAgent)) {
    const outerRealmFunctionConstructor = Node.constructor;
    return new outerRealmFunctionConstructor("return setImmediate")();
  } else {
    return void 0;
  }
}
var schedulerPostTask = typeof scheduler !== "undefined" && ((fn) => scheduler.postTask(fn));
var doSetTimeout = (fn) => setTimeout(fn, 0);
var queueTask = (fn) => {
  const setImmediate = globalThis.setImmediate || getSetImmediateFromJsdom() || schedulerPostTask || doSetTimeout;
  setImmediate(fn);
};

// node_modules/fake-indexeddb/build/esm/FDBTransaction.js
var FDBTransaction = class extends FakeEventTarget_default {
  _state = "active";
  _started = false;
  _rollbackLog = [];
  _objectStoresCache = /* @__PURE__ */ new Map();
  _openRequest = null;
  error = null;
  onabort = null;
  oncomplete = null;
  onerror = null;
  _requests = [];
  _createdIndexes = /* @__PURE__ */ new Set();
  _createdObjectStores = /* @__PURE__ */ new Set();
  constructor(storeNames, mode, durability, db) {
    super();
    this._scope = new Set(storeNames);
    this.mode = mode;
    this.durability = durability;
    this.db = db;
    this.objectStoreNames = new FakeDOMStringList_default(...Array.from(this._scope).sort());
  }
  // https://w3c.github.io/IndexedDB/#abort-transaction
  _abort(errName) {
    for (const f of this._rollbackLog.reverse()) {
      f();
    }
    if (errName !== null) {
      const e = new DOMException(void 0, errName);
      this.error = e;
    }
    for (const {
      request
    } of this._requests) {
      if (request.readyState !== "done") {
        request.readyState = "done";
        if (request.source) {
          queueTask(() => {
            request.result = void 0;
            request.error = new AbortError();
            const event = new FakeEvent_default("error", {
              bubbles: true,
              cancelable: true
            });
            event.eventPath = [this.db, this];
            try {
              request.dispatchEvent(event);
            } catch (_err) {
              if (this._state === "active") {
                this._abort("AbortError");
              }
            }
          });
        }
      }
    }
    queueTask(() => {
      const isUpgradeTransaction = this.mode === "versionchange";
      if (isUpgradeTransaction) {
        this.db._rawDatabase.connections = this.db._rawDatabase.connections.filter((connection) => !connection._rawDatabase.transactions.includes(this));
      }
      const event = new FakeEvent_default("abort", {
        bubbles: true,
        cancelable: false
      });
      event.eventPath = [this.db];
      this.dispatchEvent(event);
      if (isUpgradeTransaction) {
        const request = this._openRequest;
        request.transaction = null;
        request.result = void 0;
      }
    });
    this._state = "finished";
  }
  abort() {
    if (this._state === "committing" || this._state === "finished") {
      throw new InvalidStateError();
    }
    this._state = "active";
    this._abort(null);
  }
  // http://w3c.github.io/IndexedDB/#dom-idbtransaction-objectstore
  objectStore(name) {
    if (this._state !== "active") {
      throw new InvalidStateError();
    }
    const objectStore = this._objectStoresCache.get(name);
    if (objectStore !== void 0) {
      return objectStore;
    }
    const rawObjectStore = this.db._rawDatabase.rawObjectStores.get(name);
    if (!this._scope.has(name) || rawObjectStore === void 0) {
      throw new NotFoundError();
    }
    const objectStore2 = new FDBObjectStore_default(this, rawObjectStore);
    this._objectStoresCache.set(name, objectStore2);
    return objectStore2;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-asynchronously-executing-a-request
  _execRequestAsync(obj) {
    const source = obj.source;
    const operation = obj.operation;
    let request = Object.hasOwn(obj, "request") ? obj.request : null;
    if (this._state !== "active") {
      throw new TransactionInactiveError();
    }
    if (!request) {
      if (!source) {
        request = new FDBRequest_default();
      } else {
        request = new FDBRequest_default();
        request.source = source;
        request.transaction = source.transaction;
      }
    }
    this._requests.push({
      operation,
      request
    });
    return request;
  }
  _start() {
    this._started = true;
    let operation;
    let request;
    while (this._requests.length > 0) {
      const r = this._requests.shift();
      if (r && r.request.readyState !== "done") {
        request = r.request;
        operation = r.operation;
        break;
      }
    }
    if (request && operation) {
      if (!request.source) {
        operation();
      } else {
        let defaultAction;
        let event;
        try {
          const result = operation();
          request.readyState = "done";
          request.result = result;
          request.error = void 0;
          if (this._state === "inactive") {
            this._state = "active";
          }
          event = new FakeEvent_default("success", {
            bubbles: false,
            cancelable: false
          });
        } catch (err) {
          request.readyState = "done";
          request.result = void 0;
          request.error = err;
          if (this._state === "inactive") {
            this._state = "active";
          }
          event = new FakeEvent_default("error", {
            bubbles: true,
            cancelable: true
          });
          defaultAction = this._abort.bind(this, err.name);
        }
        try {
          event.eventPath = [this.db, this];
          request.dispatchEvent(event);
        } catch (_err) {
          if (this._state === "active") {
            this._abort("AbortError");
            defaultAction = void 0;
          }
        }
        if (!event.canceled) {
          if (defaultAction) {
            defaultAction();
          }
        }
      }
      queueTask(this._start.bind(this));
      return;
    }
    if (this._state !== "finished") {
      this._state = "finished";
      if (!this.error) {
        const event = new FakeEvent_default("complete");
        this.dispatchEvent(event);
      }
    }
  }
  commit() {
    if (this._state !== "active") {
      throw new InvalidStateError();
    }
    this._state = "committing";
  }
  get [Symbol.toStringTag]() {
    return "IDBTransaction";
  }
};
var FDBTransaction_default = FDBTransaction;

// node_modules/fake-indexeddb/build/esm/lib/KeyGenerator.js
var MAX_KEY = 9007199254740992;
var KeyGenerator = class {
  // This is kind of wrong. Should start at 1 and increment only after record is saved
  num = 0;
  next() {
    if (this.num >= MAX_KEY) {
      throw new ConstraintError();
    }
    this.num += 1;
    return this.num;
  }
  // https://w3c.github.io/IndexedDB/#possibly-update-the-key-generator
  setIfLarger(num) {
    const value = Math.floor(Math.min(num, MAX_KEY)) - 1;
    if (value >= this.num) {
      this.num = value + 1;
    }
  }
};
var KeyGenerator_default = KeyGenerator;

// node_modules/fake-indexeddb/build/esm/lib/ObjectStore.js
var ObjectStore = class {
  deleted = false;
  records = new RecordStore_default(true);
  rawIndexes = /* @__PURE__ */ new Map();
  constructor(rawDatabase, name, keyPath, autoIncrement) {
    this.rawDatabase = rawDatabase;
    this.keyGenerator = autoIncrement === true ? new KeyGenerator_default() : null;
    this.deleted = false;
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-retrieving-a-value-from-an-object-store
  getKey(key) {
    const record = this.records.get(key);
    return record !== void 0 ? structuredClone(record.key) : void 0;
  }
  // http://w3c.github.io/IndexedDB/#retrieve-multiple-keys-from-an-object-store
  getAllKeys(range, count, direction) {
    if (count === void 0 || count === 0) {
      count = Infinity;
    }
    const records = [];
    for (const record of this.records.values(range, direction)) {
      records.push(structuredClone(record.key));
      if (records.length >= count) {
        break;
      }
    }
    return records;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-retrieving-a-value-from-an-object-store
  getValue(key) {
    const record = this.records.get(key);
    return record !== void 0 ? structuredClone(record.value) : void 0;
  }
  // http://w3c.github.io/IndexedDB/#retrieve-multiple-values-from-an-object-store
  getAllValues(range, count, direction) {
    if (count === void 0 || count === 0) {
      count = Infinity;
    }
    const records = [];
    for (const record of this.records.values(range, direction)) {
      records.push(structuredClone(record.value));
      if (records.length >= count) {
        break;
      }
    }
    return records;
  }
  // https://www.w3.org/TR/IndexedDB/#dom-idbobjectstore-getallrecords
  getAllRecords(range, count, direction) {
    if (count === void 0 || count === 0) {
      count = Infinity;
    }
    const records = [];
    for (const record of this.records.values(range, direction)) {
      records.push(new FDBRecord_default(structuredClone(record.key), structuredClone(record.key), structuredClone(record.value)));
      if (records.length >= count) {
        break;
      }
    }
    return records;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-storing-a-record-into-an-object-store
  storeRecord(newRecord, noOverwrite, rollbackLog) {
    if (this.keyPath !== null) {
      const key = extractKey_default(this.keyPath, newRecord.value).key;
      if (key !== void 0) {
        newRecord.key = key;
      }
    }
    const rollbackLogForThisOperation = [];
    if (this.keyGenerator !== null && newRecord.key === void 0) {
      let rolledBack2 = false;
      const keyGeneratorBefore = this.keyGenerator.num;
      const rollbackKeyGenerator = () => {
        if (rolledBack2) {
          return;
        }
        rolledBack2 = true;
        if (this.keyGenerator) {
          this.keyGenerator.num = keyGeneratorBefore;
        }
      };
      rollbackLogForThisOperation.push(rollbackKeyGenerator);
      if (rollbackLog) {
        rollbackLog.push(rollbackKeyGenerator);
      }
      newRecord.key = this.keyGenerator.next();
      if (this.keyPath !== null) {
        if (Array.isArray(this.keyPath)) {
          throw new Error("Cannot have an array key path in an object store with a key generator");
        }
        let remainingKeyPath = this.keyPath;
        let object = newRecord.value;
        let identifier;
        let i = 0;
        while (i >= 0) {
          if (typeof object !== "object") {
            throw new DataError();
          }
          i = remainingKeyPath.indexOf(".");
          if (i >= 0) {
            identifier = remainingKeyPath.slice(0, i);
            remainingKeyPath = remainingKeyPath.slice(i + 1);
            if (!Object.hasOwn(object, identifier)) {
              Object.defineProperty(object, identifier, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: {}
              });
            }
            object = object[identifier];
          }
        }
        identifier = remainingKeyPath;
        Object.defineProperty(object, identifier, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: newRecord.key
        });
      }
    } else if (this.keyGenerator !== null && typeof newRecord.key === "number") {
      this.keyGenerator.setIfLarger(newRecord.key);
    }
    const existingRecord = this.records.put(newRecord, noOverwrite);
    let rolledBack = false;
    const rollbackStoreRecord = () => {
      if (rolledBack) {
        return;
      }
      rolledBack = true;
      if (existingRecord) {
        this.storeRecord(existingRecord, false);
      } else {
        this.deleteRecord(newRecord.key);
      }
    };
    rollbackLogForThisOperation.push(rollbackStoreRecord);
    if (rollbackLog) {
      rollbackLog.push(rollbackStoreRecord);
    }
    if (existingRecord) {
      for (const rawIndex of this.rawIndexes.values()) {
        rawIndex.records.deleteByValue(newRecord.key);
      }
    }
    try {
      for (const rawIndex of this.rawIndexes.values()) {
        if (rawIndex.initialized) {
          rawIndex.storeRecord(newRecord);
        }
      }
    } catch (err) {
      if (err.name === "ConstraintError") {
        for (const rollback of rollbackLogForThisOperation) {
          rollback();
        }
      }
      throw err;
    }
    return newRecord.key;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-deleting-records-from-an-object-store
  deleteRecord(key, rollbackLog) {
    const deletedRecords = this.records.delete(key);
    if (rollbackLog) {
      for (const record of deletedRecords) {
        rollbackLog.push(() => {
          this.storeRecord(record, true);
        });
      }
    }
    for (const rawIndex of this.rawIndexes.values()) {
      rawIndex.records.deleteByValue(key);
    }
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#dfn-steps-for-clearing-an-object-store
  clear(rollbackLog) {
    const deletedRecords = this.records.clear();
    if (rollbackLog) {
      for (const record of deletedRecords) {
        rollbackLog.push(() => {
          this.storeRecord(record, true);
        });
      }
    }
    for (const rawIndex of this.rawIndexes.values()) {
      rawIndex.records.clear();
    }
  }
  count(range) {
    if (range === void 0 || range.lower === void 0 && range.upper === void 0) {
      return this.records.size();
    }
    let count = 0;
    for (const record of this.records.values(range)) {
      count += 1;
    }
    return count;
  }
};
var ObjectStore_default = ObjectStore;

// node_modules/fake-indexeddb/build/esm/lib/closeConnection.js
var closeConnection = (connection, forced = false) => {
  connection._closePending = true;
  const transactionsComplete = connection._rawDatabase.transactions.every((transaction) => {
    return transaction._state === "finished";
  });
  if (transactionsComplete) {
    connection._closed = true;
    connection._rawDatabase.connections = connection._rawDatabase.connections.filter((otherConnection) => {
      return connection !== otherConnection;
    });
    if (forced) {
      const event = new FakeEvent_default("close", {
        bubbles: false,
        cancelable: false
      });
      event.eventPath = [];
      connection.dispatchEvent(event);
    }
  } else {
    queueTask(() => {
      closeConnection(connection, forced);
    });
  }
};
var closeConnection_default = closeConnection;

// node_modules/fake-indexeddb/build/esm/FDBDatabase.js
var confirmActiveVersionchangeTransaction = (database) => {
  let transaction;
  if (database._runningVersionchangeTransaction) {
    transaction = database._rawDatabase.transactions.findLast((tx) => {
      return tx.mode === "versionchange";
    });
  }
  if (!transaction) {
    throw new InvalidStateError();
  }
  if (transaction._state !== "active") {
    throw new TransactionInactiveError();
  }
  return transaction;
};
var FDBDatabase = class extends FakeEventTarget_default {
  _closePending = false;
  _closed = false;
  _runningVersionchangeTransaction = false;
  constructor(rawDatabase) {
    super();
    this._rawDatabase = rawDatabase;
    this._rawDatabase.connections.push(this);
    this.name = rawDatabase.name;
    this.version = rawDatabase.version;
    this.objectStoreNames = new FakeDOMStringList_default(...Array.from(rawDatabase.rawObjectStores.keys()).sort());
  }
  // http://w3c.github.io/IndexedDB/#dom-idbdatabase-createobjectstore
  createObjectStore(name, options = {}) {
    if (name === void 0) {
      throw new TypeError();
    }
    const transaction = confirmActiveVersionchangeTransaction(this);
    const keyPath = options !== null && options.keyPath !== void 0 ? options.keyPath : null;
    const autoIncrement = options !== null && options.autoIncrement !== void 0 ? options.autoIncrement : false;
    if (keyPath !== null) {
      validateKeyPath_default(keyPath);
    }
    if (this._rawDatabase.rawObjectStores.has(name)) {
      throw new ConstraintError();
    }
    if (autoIncrement && (keyPath === "" || Array.isArray(keyPath))) {
      throw new InvalidAccessError();
    }
    const objectStoreNames = [...this.objectStoreNames];
    const transactionObjectStoreNames = [...transaction.objectStoreNames];
    const rawObjectStore = new ObjectStore_default(this._rawDatabase, name, keyPath, autoIncrement);
    this.objectStoreNames._push(name);
    this.objectStoreNames._sort();
    transaction._scope.add(name);
    transaction._createdObjectStores.add(rawObjectStore);
    this._rawDatabase.rawObjectStores.set(name, rawObjectStore);
    transaction.objectStoreNames = new FakeDOMStringList_default(...this.objectStoreNames);
    transaction._rollbackLog.push(() => {
      rawObjectStore.deleted = true;
      this.objectStoreNames = new FakeDOMStringList_default(...objectStoreNames);
      transaction.objectStoreNames = new FakeDOMStringList_default(...transactionObjectStoreNames);
      transaction._scope.delete(rawObjectStore.name);
      this._rawDatabase.rawObjectStores.delete(rawObjectStore.name);
    });
    return transaction.objectStore(name);
  }
  // https://www.w3.org/TR/IndexedDB/#dom-idbdatabase-deleteobjectstore
  deleteObjectStore(name) {
    if (name === void 0) {
      throw new TypeError();
    }
    const transaction = confirmActiveVersionchangeTransaction(this);
    const store = this._rawDatabase.rawObjectStores.get(name);
    if (store === void 0) {
      throw new NotFoundError();
    }
    this.objectStoreNames = new FakeDOMStringList_default(...Array.from(this.objectStoreNames).filter((objectStoreName) => {
      return objectStoreName !== name;
    }));
    transaction.objectStoreNames = new FakeDOMStringList_default(...this.objectStoreNames);
    const objectStore = transaction._objectStoresCache.get(name);
    let prevIndexNames;
    if (objectStore) {
      prevIndexNames = [...objectStore.indexNames];
      objectStore.indexNames = new FakeDOMStringList_default();
    }
    transaction._rollbackLog.push(() => {
      store.deleted = false;
      this._rawDatabase.rawObjectStores.set(store.name, store);
      this.objectStoreNames._push(store.name);
      transaction.objectStoreNames._push(store.name);
      this.objectStoreNames._sort();
      if (objectStore && prevIndexNames) {
        objectStore.indexNames = new FakeDOMStringList_default(...prevIndexNames);
      }
    });
    store.deleted = true;
    this._rawDatabase.rawObjectStores.delete(name);
    transaction._objectStoresCache.delete(name);
  }
  transaction(storeNames, mode, options) {
    mode = mode !== void 0 ? mode : "readonly";
    if (mode !== "readonly" && mode !== "readwrite" && mode !== "versionchange") {
      throw new TypeError("Invalid mode: " + mode);
    }
    const hasActiveVersionchange = this._rawDatabase.transactions.some((transaction) => {
      return transaction._state === "active" && transaction.mode === "versionchange" && transaction.db === this;
    });
    if (hasActiveVersionchange) {
      throw new InvalidStateError();
    }
    if (this._closePending) {
      throw new InvalidStateError();
    }
    if (!Array.isArray(storeNames)) {
      storeNames = [storeNames];
    }
    if (storeNames.length === 0 && mode !== "versionchange") {
      throw new InvalidAccessError();
    }
    for (const storeName of storeNames) {
      if (!this.objectStoreNames.contains(storeName)) {
        throw new NotFoundError("No objectStore named " + storeName + " in this database");
      }
    }
    const durability = options?.durability ?? "default";
    if (durability !== "default" && durability !== "strict" && durability !== "relaxed") {
      throw new TypeError(
        // based on Firefox's error message
        `'${durability}' (value of 'durability' member of IDBTransactionOptions) is not a valid value for enumeration IDBTransactionDurability`
      );
    }
    const tx = new FDBTransaction_default(storeNames, mode, durability, this);
    this._rawDatabase.transactions.push(tx);
    this._rawDatabase.processTransactions();
    return tx;
  }
  close() {
    closeConnection_default(this);
  }
  get [Symbol.toStringTag]() {
    return "IDBDatabase";
  }
};
var FDBDatabase_default = FDBDatabase;

// node_modules/fake-indexeddb/build/esm/FDBOpenDBRequest.js
var FDBOpenDBRequest = class extends FDBRequest_default {
  onupgradeneeded = null;
  onblocked = null;
  get [Symbol.toStringTag]() {
    return "IDBOpenDBRequest";
  }
};
var FDBOpenDBRequest_default = FDBOpenDBRequest;

// node_modules/fake-indexeddb/build/esm/FDBVersionChangeEvent.js
var FDBVersionChangeEvent = class extends FakeEvent_default {
  constructor(type, parameters = {}) {
    super(type);
    this.newVersion = parameters.newVersion !== void 0 ? parameters.newVersion : null;
    this.oldVersion = parameters.oldVersion !== void 0 ? parameters.oldVersion : 0;
  }
  get [Symbol.toStringTag]() {
    return "IDBVersionChangeEvent";
  }
};
var FDBVersionChangeEvent_default = FDBVersionChangeEvent;

// node_modules/fake-indexeddb/build/esm/lib/intersection.js
function intersection(set1, set2) {
  if ("intersection" in set1) {
    return set1.intersection(set2);
  }
  return new Set([...set1].filter((item) => set2.has(item)));
}

// node_modules/fake-indexeddb/build/esm/lib/Database.js
var Database = class {
  transactions = [];
  rawObjectStores = /* @__PURE__ */ new Map();
  connections = [];
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.processTransactions = this.processTransactions.bind(this);
  }
  processTransactions() {
    queueTask(() => {
      const running = this.transactions.filter((transaction) => transaction._started && transaction._state !== "finished");
      const waiting = this.transactions.filter((transaction) => !transaction._started && transaction._state !== "finished");
      const next = waiting.find((transaction, i) => {
        const anyRunning = running.some((other) => !(transaction.mode === "readonly" && other.mode === "readonly") && intersection(other._scope, transaction._scope).size > 0);
        if (anyRunning) {
          return false;
        }
        const anyWaiting = waiting.slice(0, i).some((other) => intersection(other._scope, transaction._scope).size > 0);
        return !anyWaiting;
      });
      if (next) {
        next.addEventListener("complete", this.processTransactions);
        next.addEventListener("abort", this.processTransactions);
        next._start();
      }
    });
  }
};
var Database_default = Database;

// node_modules/fake-indexeddb/build/esm/lib/validateRequiredArguments.js
function validateRequiredArguments(numArguments, expectedNumArguments, methodName) {
  if (numArguments < expectedNumArguments) {
    throw new TypeError(`${methodName}: At least ${expectedNumArguments} ${expectedNumArguments === 1 ? "argument" : "arguments"} required, but only ${arguments.length} passed`);
  }
}

// node_modules/fake-indexeddb/build/esm/FDBFactory.js
var runTaskInConnectionQueue = (connectionQueues, name, task) => {
  const queue = connectionQueues.get(name) ?? Promise.resolve();
  connectionQueues.set(name, queue.then(task));
};
var waitForOthersClosedDelete = (databases, name, openDatabases, cb) => {
  const anyOpen = openDatabases.some((openDatabase2) => {
    return !openDatabase2._closed && !openDatabase2._closePending;
  });
  if (anyOpen) {
    queueTask(() => waitForOthersClosedDelete(databases, name, openDatabases, cb));
    return;
  }
  databases.delete(name);
  cb(null);
};
var deleteDatabase = (databases, connectionQueues, name, request, cb) => {
  const deleteDBTask = () => {
    return new Promise((resolve) => {
      const db = databases.get(name);
      const oldVersion = db !== void 0 ? db.version : 0;
      const onComplete = (err) => {
        try {
          if (err) {
            cb(err);
          } else {
            cb(null, oldVersion);
          }
        } finally {
          resolve();
        }
      };
      try {
        const db2 = databases.get(name);
        if (db2 === void 0) {
          onComplete(null);
          return;
        }
        const openConnections = db2.connections.filter((connection) => {
          return !connection._closed;
        });
        for (const openDatabase2 of openConnections) {
          if (!openDatabase2._closePending) {
            queueTask(() => {
              const event = new FDBVersionChangeEvent_default("versionchange", {
                newVersion: null,
                oldVersion: db2.version
              });
              openDatabase2.dispatchEvent(event);
            });
          }
        }
        queueTask(() => {
          const anyOpen = openConnections.some((openDatabase3) => {
            return !openDatabase3._closed && !openDatabase3._closePending;
          });
          if (anyOpen) {
            queueTask(() => {
              const event = new FDBVersionChangeEvent_default("blocked", {
                newVersion: null,
                oldVersion: db2.version
              });
              request.dispatchEvent(event);
            });
          }
          waitForOthersClosedDelete(databases, name, openConnections, onComplete);
        });
      } catch (err) {
        onComplete(err);
      }
    });
  };
  runTaskInConnectionQueue(connectionQueues, name, deleteDBTask);
};
var runVersionchangeTransaction = (connection, version, request, cb) => {
  connection._runningVersionchangeTransaction = true;
  const oldVersion = connection._oldVersion = connection.version;
  const openConnections = connection._rawDatabase.connections.filter((otherDatabase) => {
    return connection !== otherDatabase;
  });
  for (const openDatabase2 of openConnections) {
    if (!openDatabase2._closed && !openDatabase2._closePending) {
      queueTask(() => {
        const event = new FDBVersionChangeEvent_default("versionchange", {
          newVersion: version,
          oldVersion
        });
        openDatabase2.dispatchEvent(event);
      });
    }
  }
  queueTask(() => {
    const anyOpen = openConnections.some((openDatabase3) => {
      return !openDatabase3._closed && !openDatabase3._closePending;
    });
    if (anyOpen) {
      queueTask(() => {
        const event = new FDBVersionChangeEvent_default("blocked", {
          newVersion: version,
          oldVersion
        });
        request.dispatchEvent(event);
      });
    }
    const waitForOthersClosed = () => {
      const anyOpen2 = openConnections.some((openDatabase2) => {
        return !openDatabase2._closed && !openDatabase2._closePending;
      });
      if (anyOpen2) {
        queueTask(waitForOthersClosed);
        return;
      }
      connection._rawDatabase.version = version;
      connection.version = version;
      const transaction = connection.transaction(Array.from(connection.objectStoreNames), "versionchange");
      transaction._openRequest = request;
      request.result = connection;
      request.readyState = "done";
      request.transaction = transaction;
      transaction._rollbackLog.push(() => {
        connection._rawDatabase.version = oldVersion;
        connection.version = oldVersion;
      });
      transaction._state = "active";
      const event = new FDBVersionChangeEvent_default("upgradeneeded", {
        newVersion: version,
        oldVersion
      });
      let didThrow = false;
      try {
        request.dispatchEvent(event);
      } catch (_err) {
        didThrow = true;
      }
      const concludeUpgrade = () => {
        if (transaction._state === "active") {
          transaction._state = "inactive";
          if (didThrow) {
            transaction._abort("AbortError");
          }
        }
      };
      if (didThrow) {
        concludeUpgrade();
      } else {
        queueTask(concludeUpgrade);
      }
      transaction.addEventListener("error", () => {
        connection._runningVersionchangeTransaction = false;
        connection._oldVersion = void 0;
      });
      transaction.addEventListener("abort", () => {
        connection._runningVersionchangeTransaction = false;
        connection._oldVersion = void 0;
        request.transaction = null;
        queueTask(() => {
          cb(new AbortError());
        });
      });
      transaction.addEventListener("complete", () => {
        connection._runningVersionchangeTransaction = false;
        connection._oldVersion = void 0;
        request.transaction = null;
        queueTask(() => {
          if (connection._closePending) {
            cb(new AbortError());
          } else {
            cb(null);
          }
        });
      });
    };
    waitForOthersClosed();
  });
};
var openDatabase = (databases, connectionQueues, name, version, request, cb) => {
  const openDBTask = () => {
    return new Promise((resolve) => {
      const onComplete = (err) => {
        try {
          if (err) {
            cb(err);
          } else {
            cb(null, connection);
          }
        } finally {
          resolve();
        }
      };
      let db = databases.get(name);
      if (db === void 0) {
        db = new Database_default(name, 0);
        databases.set(name, db);
      }
      if (version === void 0) {
        version = db.version !== 0 ? db.version : 1;
      }
      if (db.version > version) {
        return onComplete(new VersionError());
      }
      const connection = new FDBDatabase_default(db);
      if (db.version < version) {
        runVersionchangeTransaction(connection, version, request, (err) => {
          onComplete(err);
        });
      } else {
        onComplete(null);
      }
    });
  };
  runTaskInConnectionQueue(connectionQueues, name, openDBTask);
};
var FDBFactory = class {
  _databases = /* @__PURE__ */ new Map();
  // https://w3c.github.io/IndexedDB/#connection-queue
  _connectionQueues = /* @__PURE__ */ new Map();
  // promise chain as lightweight FIFO task queue
  // https://w3c.github.io/IndexedDB/#dom-idbfactory-cmp
  cmp(first, second) {
    validateRequiredArguments(arguments.length, 2, "IDBFactory.cmp");
    return cmp_default(first, second);
  }
  // https://w3c.github.io/IndexedDB/#dom-idbfactory-deletedatabase
  deleteDatabase(name) {
    validateRequiredArguments(arguments.length, 1, "IDBFactory.deleteDatabase");
    const request = new FDBOpenDBRequest_default();
    request.source = null;
    queueTask(() => {
      deleteDatabase(this._databases, this._connectionQueues, name, request, (err, oldVersion) => {
        if (err) {
          request.error = new DOMException(err.message, err.name);
          request.readyState = "done";
          const event = new FakeEvent_default("error", {
            bubbles: true,
            cancelable: true
          });
          event.eventPath = [];
          request.dispatchEvent(event);
          return;
        }
        request.result = void 0;
        request.readyState = "done";
        const event2 = new FDBVersionChangeEvent_default("success", {
          newVersion: null,
          oldVersion
        });
        request.dispatchEvent(event2);
      });
    });
    return request;
  }
  // http://www.w3.org/TR/2015/REC-IndexedDB-20150108/#widl-IDBFactory-open-IDBOpenDBRequest-DOMString-name-unsigned-long-long-version
  open(name, version) {
    validateRequiredArguments(arguments.length, 1, "IDBFactory.open");
    if (arguments.length > 1 && version !== void 0) {
      version = enforceRange_default(version, "MAX_SAFE_INTEGER");
    }
    if (version === 0) {
      throw new TypeError("Database version cannot be 0");
    }
    const request = new FDBOpenDBRequest_default();
    request.source = null;
    queueTask(() => {
      openDatabase(this._databases, this._connectionQueues, name, version, request, (err, connection) => {
        if (err) {
          request.result = void 0;
          request.readyState = "done";
          request.error = new DOMException(err.message, err.name);
          const event = new FakeEvent_default("error", {
            bubbles: true,
            cancelable: true
          });
          event.eventPath = [];
          request.dispatchEvent(event);
          return;
        }
        request.result = connection;
        request.readyState = "done";
        const event2 = new FakeEvent_default("success");
        event2.eventPath = [];
        request.dispatchEvent(event2);
      });
    });
    return request;
  }
  // https://w3c.github.io/IndexedDB/#dom-idbfactory-databases
  databases() {
    return Promise.resolve(Array.from(this._databases.entries(), ([name, database]) => {
      const activeVersionChangeConnection = database.connections.find((connection) => connection._runningVersionchangeTransaction);
      const version = activeVersionChangeConnection ? activeVersionChangeConnection._oldVersion : database.version;
      return {
        name,
        version
      };
    }).filter(({
      version
    }) => {
      return version > 0;
    }));
  }
  get [Symbol.toStringTag]() {
    return "IDBFactory";
  }
};
var FDBFactory_default = FDBFactory;

// node_modules/fake-indexeddb/build/esm/fakeIndexedDB.js
var fakeIndexedDB = new FDBFactory_default();

// src/profile-crypto.js
var FORMAT2 = "qvault-profile-v2";
var MAX = 4 * 1024 * 1024;
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var toBase64 = (b) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
function fromBase64(s, max = MAX) {
  if (typeof s !== "string" || s.length > max * 2 || !s.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error("Invalid encrypted profile");
  const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (b.length > max) throw Error("Oversized encrypted profile");
  return b;
}
var isPasskeyProfile = (record) => record?.format === FORMAT2;
var sized = (value, size) => {
  try {
    return fromBase64(value, size).length === size;
  } catch {
    return false;
  }
};
function validateSlot(slot) {
  if (!slot || !["passkey", "recovery"].includes(slot.type) || !sized(slot.salt, 16) || !sized(slot.nonce, 12) || !sized(slot.wrapped, 48)) throw Error("Invalid encrypted profile");
  if (slot.type === "passkey") {
    let id;
    try {
      id = fromBase64(slot.credentialId, 1024);
    } catch {
      throw Error("Invalid encrypted profile");
    }
    if (!id.length || !sized(slot.prfSalt, 32)) throw Error("Invalid encrypted profile");
  }
}
function validateEnvelope(record) {
  if (isPasskeyProfile(record)) {
    if (!/^[a-f0-9-]{36}$/.test(record.profileId) || !/^[a-f0-9-]{36}$/.test(record.revision) || !Array.isArray(record.slots) || record.slots.length < 1 || record.slots.length > 8) throw Error("Unsupported encrypted profile");
    for (const slot of record.slots) validateSlot(slot);
    if (!record.slots.some((s) => s.type === "recovery")) throw Error("Invalid encrypted profile");
    if (fromBase64(record.nonce, 12).length !== 12 || fromBase64(record.ciphertext).length < 16) throw Error("Invalid encrypted profile");
    return record;
  }
  throw Error("Unsupported encrypted profile");
}
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var NO_OPEN = "This passkey or recovery key does not open the saved vault";
function generateRecoveryKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  let bits = 0, value = 0, out = "";
  for (const b of raw) {
    value = value << 8 | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits) out += ALPHABET[value << 5 - bits & 31];
  raw.fill(0);
  return out.match(/.{4}/g).join("-");
}
function parseRecoveryKey(text) {
  if (typeof text !== "string") throw Error("Invalid recovery key");
  const clean = text.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z2-7]{52}$/.test(clean)) throw Error("Invalid recovery key");
  const out = new Uint8Array(32);
  let bits = 0, value = 0, index = 0;
  for (const c of clean) {
    value = value << 5 | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      if (index < 32) out[index++] = value >>> bits - 8 & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  if (index !== 32 || value !== 0) {
    out.fill(0);
    throw Error("Invalid recovery key");
  }
  return out;
}
var slotAad = (profileId, slot) => encoder.encode(JSON.stringify({ format: FORMAT2, purpose: "profile-key", profileId, type: slot.type, credentialId: slot.credentialId ?? null, prfSalt: slot.prfSalt ?? null }));
var aad2 = (record) => encoder.encode(JSON.stringify({ format: FORMAT2, profileId: record.profileId, revision: record.revision }));
async function slotKey(secret, salt, type, usage) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("qvault-profile-key/" + type) }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}
async function wrapSlot(slot, secret, raw, profileId) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12)), key = await slotKey(secret, salt, slot.type, "encrypt");
  return { ...slot, salt: toBase64(salt), nonce: toBase64(nonce), wrapped: toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: slotAad(profileId, slot) }, key, raw))) };
}
async function unwrapSlot(slot, secret, profileId) {
  const key = await slotKey(secret, fromBase64(slot.salt, 16), slot.type, "decrypt");
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(slot.nonce, 12), additionalData: slotAad(profileId, slot) }, key, fromBase64(slot.wrapped, 48)));
  try {
    if (raw.length !== 32) throw Error();
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}
async function createPasskeyProfile({ prf, credentialId, prfSalt, profileId = crypto.randomUUID() }) {
  if (!(prf instanceof Uint8Array) || prf.length < 32) throw Error("Invalid passkey secret");
  if (!/^[a-f0-9-]{36}$/.test(profileId)) throw Error("Invalid profile identifier");
  const raw = crypto.getRandomValues(new Uint8Array(32)), recoveryKey = generateRecoveryKey(), recoveryBytes = parseRecoveryKey(recoveryKey);
  try {
    const slots = [await wrapSlot({ type: "passkey", credentialId, prfSalt }, prf, raw, profileId), await wrapSlot({ type: "recovery" }, recoveryBytes, raw, profileId)];
    for (const slot of slots) validateSlot(slot);
    return { handle: { format: FORMAT2, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]), profileId, slots }, recoveryKey };
  } finally {
    raw.fill(0);
    recoveryBytes.fill(0);
  }
}
async function sealPasskeyProfile(payload, handle2) {
  const record = { format: FORMAT2, profileId: handle2.profileId, revision: crypto.randomUUID(), slots: handle2.slots, nonce: toBase64(crypto.getRandomValues(new Uint8Array(12))) };
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.length > MAX - 16) {
    bytes.fill(0);
    throw Error("Profile is too large");
  }
  try {
    record.ciphertext = toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: aad2(record) }, handle2.key, bytes)));
    return record;
  } finally {
    bytes.fill(0);
  }
}
async function openPasskeyProfile(record, secret) {
  let bytes = null, type;
  if (secret?.prf instanceof Uint8Array && secret.prf.length >= 32) {
    bytes = secret.prf;
    type = "passkey";
  } else if (typeof secret?.recoveryKey === "string") {
    try {
      bytes = parseRecoveryKey(secret.recoveryKey);
    } catch {
      throw Error(NO_OPEN);
    }
    type = "recovery";
  } else throw Error(NO_OPEN);
  let key = null;
  try {
    for (const slot of record.slots.filter((s) => s.type === type)) {
      try {
        key = await unwrapSlot(slot, bytes, record.profileId);
        break;
      } catch {
      }
    }
  } finally {
    if (type === "recovery") bytes.fill(0);
  }
  if (!key) throw Error(NO_OPEN);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: aad2(record) }, key, fromBase64(record.ciphertext)));
    return { payload: JSON.parse(decoder.decode(plain)), handle: { format: FORMAT2, key, profileId: record.profileId, slots: record.slots } };
  } catch {
    throw Error(NO_OPEN);
  } finally {
    plain?.fill(0);
  }
}
async function sealProfile(payload, handle2) {
  if (handle2?.format !== FORMAT2) throw Error("Unsupported profile key");
  return sealPasskeyProfile(payload, handle2);
}
async function openProfile(record, secret) {
  validateEnvelope(record);
  return openPasskeyProfile(record, secret);
}

// src/profile-store.js
var DB = "qvault-protected";
var STORE = "profiles";
var KEY = "active";
var LOCK_MINUTES = [1, 5, 15, 30];
var ProfileStore = class {
  constructor(idb = globalThis.indexedDB) {
    this.idb = idb;
  }
  async db() {
    if (!this.idb) throw Error("Protected browser storage is unavailable");
    return new Promise((resolve, reject) => {
      const r = this.idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onerror = () => reject(Error("Could not open protected browser storage"));
      r.onblocked = () => reject(Error("Close other QVault tabs before opening storage"));
      r.onsuccess = () => resolve(r.result);
    });
  }
  async getDeviceId() {
    const db = await this.db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), r = store.get("device-id");
        let value;
        r.onsuccess = () => {
          value = r.result;
          if (!value) {
            value = crypto.randomUUID();
            store.put(value, "device-id");
          }
        };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(Error("Could not read device identity"));
        tx.onabort = () => reject(Error("Device identity read aborted"));
      });
    } finally {
      db.close();
    }
  }
  async read() {
    const db = await this.db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly"), r = tx.objectStore(STORE).get(KEY);
        let value = null;
        r.onsuccess = () => {
          value = r.result ?? null;
        };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(Error("Could not read protected profile"));
        tx.onabort = () => reject(Error("Profile read aborted"));
      });
    } finally {
      db.close();
    }
  }
  async save(record, expectedRevision = null) {
    validateEnvelope(record);
    const db = await this.db();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), r = store.get(KEY);
        let conflict = false;
        r.onsuccess = () => {
          const current = r.result;
          if ((current?.revision ?? null) !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          store.put(record, KEY);
          store.delete("setup-storage");
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(Error(conflict ? "Profile changed in another tab; lock and unlock before saving" : "Profile save aborted"));
        tx.onerror = () => reject(Error("Could not save protected profile"));
      });
    } finally {
      db.close();
    }
  }
  // Small device-local helpers. The snapshot copy is the same ciphertext as the cloud object; the capability record holds no secret.
  async value(key) {
    const db = await this.db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly"), r = tx.objectStore(STORE).get(key);
        let result = null;
        r.onsuccess = () => result = r.result ?? null;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(Error("Could not read local data"));
        tx.onabort = () => reject(Error("Local data read aborted"));
      });
    } finally {
      db.close();
    }
  }
  async put(key, value) {
    const db = await this.db();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(Error("Could not save local data"));
        tx.onabort = () => reject(Error("Local data save aborted"));
      });
    } finally {
      db.close();
    }
  }
  async readSnapshotCache(object) {
    const entry2 = await this.value("snapshot-cache");
    return entry2 && entry2.object === object && typeof entry2.text === "string" ? entry2.text : null;
  }
  async writeSnapshotCache(object, text) {
    if (typeof object !== "string" || !/^qvault\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/.test(object) || typeof text !== "string") throw Error("Invalid snapshot copy");
    if (text.length > 2 * 1024 * 1024 + 65536) throw Error("Snapshot copy is too large");
    await this.put("snapshot-cache", { object, text });
  }
  // How long an unlocked vault may sit unused before it locks itself. Not a secret; kept beside the profile.
  async readLockMinutes() {
    const v = await this.value("lock-minutes");
    return LOCK_MINUTES.includes(v) ? v : null;
  }
  async writeLockMinutes(v) {
    if (!LOCK_MINUTES.includes(v)) throw Error("Invalid lock time");
    await this.put("lock-minutes", v);
  }
  // Whether showing a saved password in the editor needs the passkey again. On unless the person turned it off.
  async readConfirmReveal() {
    return await this.value("confirm-reveal") !== false;
  }
  async writeConfirmReveal(v) {
    if (typeof v !== "boolean") throw Error("Invalid setting");
    await this.put("confirm-reveal", v);
  }
  async readCapability() {
    const c = await this.value("sync-capability");
    return c && typeof c.profileId === "string" && typeof c.bucket === "string" && typeof c.region === "string" && ["shared", "single"].includes(c.mode) && Number.isFinite(c.checkedAt) ? c : null;
  }
  async writeCapability({ profileId, bucket, region, mode, checkedAt }) {
    if (typeof profileId !== "string" || typeof bucket !== "string" || typeof region !== "string" || !["shared", "single"].includes(mode) || !Number.isFinite(checkedAt)) throw Error("Invalid capability record");
    await this.put("sync-capability", { profileId, bucket, region, mode, checkedAt });
  }
  async reset(expectedRevision, kind = "profile") {
    if (typeof expectedRevision !== "string" || !/^[a-f0-9-]{36}$/.test(expectedRevision)) throw Error("Refresh Setup before resetting this device");
    const db = await this.db();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), r = store.get(kind === "settings" ? "setup-storage" : KEY);
        let conflict = false;
        r.onsuccess = () => {
          if (r.result?.revision !== expectedRevision) {
            conflict = true;
            tx.abort();
            return;
          }
          const active = store.get(KEY);
          active.onsuccess = () => {
            if (kind === "settings" && active.result) {
              conflict = true;
              tx.abort();
              return;
            }
            store.delete(KEY);
            store.delete("device-id");
            store.delete("setup-storage");
            store.delete("snapshot-cache");
            store.delete("sync-capability");
          };
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(Error(conflict ? "Profile changed. Open Reset this device again and review it." : "Local reset aborted"));
        tx.onerror = () => reject(Error("Could not reset this device"));
      });
    } finally {
      db.close();
    }
  }
};

// src/snapshot-discovery.js
function field(xml, name) {
  const matches = [...xml.matchAll(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">", "g"))];
  if (matches.length !== 1) throw Error("Invalid cloud snapshot listing");
  return matches[0][1].replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[e]).replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, h, d) => String.fromCodePoint(parseInt(h || d, h ? 16 : 10)));
}
function parseSnapshotPage(xml, profileId) {
  if (xml.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<ListBucketResult(?:\s[^>]*)?>/.test(xml) || !/<\/ListBucketResult>\s*$/.test(xml)) throw Error("Invalid cloud snapshot listing");
  const prefix = "qvault/" + profileId + "/", items = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = field(match[1], "Key");
    if (!key.startsWith(prefix)) throw Error("Cloud listing returned another vault");
    if (!/^[a-f0-9-]{36}\.json$/.test(key.slice(prefix.length))) continue;
    const modified = Date.parse(field(match[1], "LastModified"));
    if (!Number.isFinite(modified)) throw Error("Invalid cloud snapshot date");
    items.push({ object: key, modified });
  }
  const truncated = field(xml, "IsTruncated");
  if (!["true", "false"].includes(truncated)) throw Error("Invalid cloud snapshot listing");
  return { items, next: truncated === "true" ? field(xml, "NextContinuationToken") : null };
}
async function listSnapshots({ requestPage, profileId, signal }) {
  let token = null;
  const items = [], seen = /* @__PURE__ */ new Set(), tokens = /* @__PURE__ */ new Set();
  do {
    if (signal?.aborted) throw Error("Vault locked");
    const page = parseSnapshotPage(await requestPage(token), profileId);
    for (const item of page.items) {
      if (seen.has(item.object)) continue;
      seen.add(item.object);
      if (items.length >= 1e4) throw Error("Too many cloud snapshots. Recovery needs review.");
      items.push(item);
    }
    token = page.next;
    if (token) {
      if (tokens.has(token) || tokens.size >= 100) throw Error("Invalid cloud snapshot pagination");
      tokens.add(token);
    }
  } while (token);
  return items;
}
async function discoverSnapshot({ requestPage, profileId, reference, signal }) {
  const items = await listSnapshots({ requestPage, profileId, signal });
  let latest = null, tied = false;
  for (const item of items) {
    if (!latest || item.modified > latest.modified) {
      latest = item;
      tied = false;
    } else if (item.modified === latest.modified) tied = true;
  }
  if (tied) throw Error("Several cloud snapshots have the same date. Recovery needs review; no snapshot was selected.");
  if (reference && !items.some((item) => item.object === reference.object)) throw Error("Saved cloud snapshot is missing from the listing. Your profile was not changed.");
  return latest ? { object: latest.object } : null;
}

// node_modules/aws4fetch/dist/aws4fetch.esm.mjs
var encoder2 = new TextEncoder();
var HOST_SERVICES = {
  appstream2: "appstream",
  cloudhsmv2: "cloudhsm",
  email: "ses",
  marketplace: "aws-marketplace",
  mobile: "AWSMobileHubService",
  pinpoint: "mobiletargeting",
  queue: "sqs",
  "git-codecommit": "codecommit",
  "mturk-requester-sandbox": "mturk-requester",
  "personalize-runtime": "personalize"
};
var UNSIGNABLE_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
  "x-amzn-trace-id",
  "range",
  "connection"
]);
var AwsClient = class {
  constructor({ accessKeyId, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }) {
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.service = service;
    this.region = region;
    this.cache = cache || /* @__PURE__ */ new Map();
    this.retries = retries != null ? retries : 10;
    this.initRetryMs = initRetryMs || 50;
  }
  async sign(input, init) {
    if (input instanceof Request) {
      const { method, url, headers, body } = input;
      init = Object.assign({ method, url, headers }, init);
      if (init.body == null && headers.has("Content-Type")) {
        init.body = body != null && headers.has("X-Amz-Content-Sha256") ? body : await input.clone().arrayBuffer();
      }
      input = url;
    }
    const signer = new AwsV4Signer(Object.assign({ url: input.toString() }, init, this, init && init.aws));
    const signed = Object.assign({}, init, await signer.sign());
    delete signed.aws;
    try {
      return new Request(signed.url.toString(), signed);
    } catch (e) {
      if (e instanceof TypeError) {
        return new Request(signed.url.toString(), Object.assign({ duplex: "half" }, signed));
      }
      throw e;
    }
  }
  async fetch(input, init) {
    for (let i = 0; i <= this.retries; i++) {
      const fetched = fetch(await this.sign(input, init));
      if (i === this.retries) {
        return fetched;
      }
      const res = await fetched;
      if (res.status < 500 && res.status !== 429) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * this.initRetryMs * Math.pow(2, i)));
    }
    throw new Error("An unknown error occurred, ensure retries is not negative");
  }
};
var AwsV4Signer = class {
  constructor({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
    if (url == null) throw new TypeError("url is a required option");
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.method = method || (body ? "POST" : "GET");
    this.url = new URL(url);
    this.headers = new Headers(headers || {});
    this.body = body;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    let guessedService, guessedRegion;
    if (!service || !region) {
      [guessedService, guessedRegion] = guessServiceRegion(this.url, this.headers);
    }
    this.service = service || guessedService || "";
    this.region = region || guessedRegion || "us-east-1";
    this.cache = cache || /* @__PURE__ */ new Map();
    this.datetime = datetime || (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
    this.signQuery = signQuery;
    this.appendSessionToken = appendSessionToken || this.service === "iotdevicegateway";
    this.headers.delete("Host");
    if (this.service === "s3" && !this.signQuery && !this.headers.has("X-Amz-Content-Sha256")) {
      this.headers.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
    }
    const params = this.signQuery ? this.url.searchParams : this.headers;
    params.set("X-Amz-Date", this.datetime);
    if (this.sessionToken && !this.appendSessionToken) {
      params.set("X-Amz-Security-Token", this.sessionToken);
    }
    this.signableHeaders = ["host", ...this.headers.keys()].filter((header) => allHeaders || !UNSIGNABLE_HEADERS.has(header)).sort();
    this.signedHeaders = this.signableHeaders.join(";");
    this.canonicalHeaders = this.signableHeaders.map((header) => header + ":" + (header === "host" ? this.url.host : (this.headers.get(header) || "").replace(/\s+/g, " "))).join("\n");
    this.credentialString = [this.datetime.slice(0, 8), this.region, this.service, "aws4_request"].join("/");
    if (this.signQuery) {
      if (this.service === "s3" && !params.has("X-Amz-Expires")) {
        params.set("X-Amz-Expires", "86400");
      }
      params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      params.set("X-Amz-Credential", this.accessKeyId + "/" + this.credentialString);
      params.set("X-Amz-SignedHeaders", this.signedHeaders);
    }
    if (this.service === "s3") {
      try {
        this.encodedPath = decodeURIComponent(this.url.pathname.replace(/\+/g, " "));
      } catch (e) {
        this.encodedPath = this.url.pathname;
      }
    } else {
      this.encodedPath = this.url.pathname.replace(/\/+/g, "/");
    }
    if (!singleEncode) {
      this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, "/");
    }
    this.encodedPath = encodeRfc3986(this.encodedPath);
    const seenKeys = /* @__PURE__ */ new Set();
    this.encodedSearch = [...this.url.searchParams].filter(([k]) => {
      if (!k) return false;
      if (this.service === "s3") {
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
      }
      return true;
    }).map((pair2) => pair2.map((p) => encodeRfc3986(encodeURIComponent(p)))).sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0).map((pair2) => pair2.join("=")).join("&");
  }
  async sign() {
    if (this.signQuery) {
      this.url.searchParams.set("X-Amz-Signature", await this.signature());
      if (this.sessionToken && this.appendSessionToken) {
        this.url.searchParams.set("X-Amz-Security-Token", this.sessionToken);
      }
    } else {
      this.headers.set("Authorization", await this.authHeader());
    }
    return {
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: this.body
    };
  }
  async authHeader() {
    return [
      "AWS4-HMAC-SHA256 Credential=" + this.accessKeyId + "/" + this.credentialString,
      "SignedHeaders=" + this.signedHeaders,
      "Signature=" + await this.signature()
    ].join(", ");
  }
  async signature() {
    const date = this.datetime.slice(0, 8);
    const cacheKey = [this.secretAccessKey, date, this.region, this.service].join();
    let kCredentials = this.cache.get(cacheKey);
    if (!kCredentials) {
      const kDate = await hmac("AWS4" + this.secretAccessKey, date);
      const kRegion = await hmac(kDate, this.region);
      const kService = await hmac(kRegion, this.service);
      kCredentials = await hmac(kService, "aws4_request");
      this.cache.set(cacheKey, kCredentials);
    }
    return buf2hex(await hmac(kCredentials, await this.stringToSign()));
  }
  async stringToSign() {
    return [
      "AWS4-HMAC-SHA256",
      this.datetime,
      this.credentialString,
      buf2hex(await hash(await this.canonicalString()))
    ].join("\n");
  }
  async canonicalString() {
    return [
      this.method.toUpperCase(),
      this.encodedPath,
      this.encodedSearch,
      this.canonicalHeaders + "\n",
      this.signedHeaders,
      await this.hexBodyHash()
    ].join("\n");
  }
  async hexBodyHash() {
    let hashHeader = this.headers.get("X-Amz-Content-Sha256") || (this.service === "s3" && this.signQuery ? "UNSIGNED-PAYLOAD" : null);
    if (hashHeader == null) {
      if (this.body && typeof this.body !== "string" && !("byteLength" in this.body)) {
        throw new Error("body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header");
      }
      hashHeader = buf2hex(await hash(this.body || ""));
    }
    return hashHeader;
  }
};
async function hmac(key, string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder2.encode(key) : key,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder2.encode(string));
}
async function hash(content) {
  return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder2.encode(content) : content);
}
var HEX_CHARS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
function buf2hex(arrayBuffer) {
  const buffer = new Uint8Array(arrayBuffer);
  let out = "";
  for (let idx = 0; idx < buffer.length; idx++) {
    const n = buffer[idx];
    out += HEX_CHARS[n >>> 4 & 15];
    out += HEX_CHARS[n & 15];
  }
  return out;
}
function encodeRfc3986(urlEncodedStr) {
  return urlEncodedStr.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function guessServiceRegion(url, headers) {
  const { hostname, pathname } = url;
  if (hostname.endsWith(".on.aws")) {
    const match2 = hostname.match(/^[^.]{1,63}\.lambda-url\.([^.]{1,63})\.on\.aws$/);
    return match2 != null ? ["lambda", match2[1] || ""] : ["", ""];
  }
  if (hostname.endsWith(".r2.cloudflarestorage.com")) {
    return ["s3", "auto"];
  }
  if (hostname.endsWith(".backblazeb2.com")) {
    const match2 = hostname.match(/^(?:[^.]{1,63}\.)?s3\.([^.]{1,63})\.backblazeb2\.com$/);
    return match2 != null ? ["s3", match2[1] || ""] : ["", ""];
  }
  const match = hostname.replace("dualstack.", "").match(/([^.]{1,63})\.(?:([^.]{0,63})\.)?amazonaws\.com(?:\.cn)?$/);
  let service = match && match[1] || "";
  let region = match && match[2];
  if (region === "us-gov") {
    region = "us-gov-west-1";
  } else if (region === "s3" || region === "s3-accelerate") {
    region = "us-east-1";
    service = "s3";
  } else if (service === "iot") {
    if (hostname.startsWith("iot.")) {
      service = "execute-api";
    } else if (hostname.startsWith("data.jobs.iot.")) {
      service = "iot-jobs-data";
    } else {
      service = pathname === "/mqtt" ? "iotdevicegateway" : "iotdata";
    }
  } else if (service === "autoscaling") {
    const targetPrefix = (headers.get("X-Amz-Target") || "").split(".")[0];
    if (targetPrefix === "AnyScaleFrontendService") {
      service = "application-autoscaling";
    } else if (targetPrefix === "AnyScaleScalingPlannerFrontendService") {
      service = "autoscaling-plans";
    }
  } else if (region == null && service.startsWith("s3-")) {
    region = service.slice(3).replace(/^fips-|^external-1/, "");
    service = "s3";
  } else if (service.endsWith("-fips")) {
    service = service.slice(0, -5);
  } else if (region && /-\d$/.test(service) && !/-\d$/.test(region)) {
    [service, region] = [region, service];
  }
  return [HOST_SERVICES[service] || service, region || ""];
}

// src/sync-transport.js
var FORMAT = "qvault-sync-head-v1";
var SyncUnavailable = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncUnavailable";
    this.code = "SYNC_UNAVAILABLE";
  }
};
var SyncConflict = class extends Error {
  constructor() {
    super("Cloud state changed. Retrying the merge.");
    this.name = "SyncConflict";
  }
};
var sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(Error("Vault locked"));
  const abort = () => {
    clearTimeout(timer);
    reject(Error("Vault locked"));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", abort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", abort, { once: true });
});
var SyncTransport = class {
  constructor({ credentials: credentials2, profileId, keyId: keyId2, handle: handle2, fetcher, now = () => Date.now(), leaseWaitMs = 6e4, leaseTtlMs = 3e5, operationMs = 12e4 }) {
    if (!/^[a-f0-9-]{36}$/.test(profileId)) throw Error("Invalid sync profile");
    Object.assign(this, { credentials: credentials2, profileId, keyId: keyId2, handle: handle2, now, leaseWaitMs, leaseTtlMs, operationMs });
    this.prefix = "qvault/" + profileId + "/sync/v1/";
    this.fetcher = fetcher || new AwsClient({ accessKeyId: credentials2.accessKey, secretAccessKey: credentials2.secretKey, service: "s3", region: credentials2.region, retries: 0 });
  }
  page(signal) {
    return async (token) => {
      const url = new URL("https://qstorage.quilibrium.com/" + this.credentials.bucket);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", "qvault/" + this.profileId + "/");
      url.searchParams.set("max-keys", "1000");
      if (token) url.searchParams.set("continuation-token", token);
      const r = await this.fetcher.fetch(url.toString(), { method: "GET", redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15e3)]) : AbortSignal.timeout(15e3) });
      if (!r.ok) throw Object.assign(Error(r.status === 403 ? "QVault cannot list cloud backups. Allow this account to list the vault\u2019s storage, then unlock again. No saved data was changed." : "Cloud backup discovery HTTP " + r.status), { status: r.status });
      return r.text();
    };
  }
  async latestSnapshot(reference, signal) {
    return discoverSnapshot({ profileId: this.profileId, reference, signal, requestPage: this.page(signal) });
  }
  async listSnapshotItems(signal) {
    return listSnapshots({ profileId: this.profileId, signal, requestPage: this.page(signal) });
  }
  // Only this profile's own immutable snapshots (<uuid>.json directly under its prefix) can be deleted.
  async deleteSnapshot(object, signal) {
    const base = "qvault/" + this.profileId + "/";
    if (typeof object !== "string" || !object.startsWith(base) || !/^[a-f0-9-]{36}\.json$/.test(object.slice(base.length))) throw Error("Invalid cloud snapshot name");
    return this.fetcher.fetch("https://qstorage.quilibrium.com/" + this.credentials.bucket + "/" + object, { method: "DELETE", redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15e3)]) : AbortSignal.timeout(15e3) });
  }
  // Housekeeping after a save. Keeps the newest snapshots and anything recent, never the ones in `protect`; quiet when not permitted.
  async pruneSnapshots({ keep = 20, minAgeMs = 30 * 864e5, maxDeletes = 50, protect = [], signal } = {}) {
    let items;
    try {
      items = await this.listSnapshotItems(signal);
    } catch {
      return { deleted: 0, denied: true };
    }
    const safe = new Set(protect.filter(Boolean)), cutoff = this.now() - minAgeMs;
    const victims = items.sort((a, b) => b.modified - a.modified || a.object.localeCompare(b.object)).slice(keep).filter((i) => i.modified < cutoff && !safe.has(i.object)).reverse().slice(0, maxDeletes);
    let deleted = 0;
    for (const item of victims) {
      let r;
      try {
        r = await this.deleteSnapshot(item.object, signal);
      } catch {
        return { deleted, denied: true };
      }
      if (r.ok || r.status === 404) deleted++;
      else return { deleted, denied: true };
    }
    return { deleted, denied: false };
  }
  async request(name, { method = "GET", body, etag, create = false, signal } = {}) {
    if (!/^[a-z0-9/._-]+$/.test(name)) throw Error("Invalid sync object");
    const headers = {};
    if (body !== void 0) headers["Content-Type"] = "application/json";
    if (etag) headers["If-Match"] = etag;
    if (create) headers["If-None-Match"] = "*";
    return this.fetcher.fetch("https://qstorage.quilibrium.com/" + this.credentials.bucket + "/" + this.prefix + name, { method, body: body === void 0 ? void 0 : JSON.stringify(body), headers, redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15e3)]) : AbortSignal.timeout(15e3) });
  }
  etag(response) {
    const value = response.headers.get("etag");
    if (!value || !/^"[^"\r\n]{1,200}"$/.test(value)) throw Error("QStorage must return a strong ETag for safe sync");
    return value;
  }
  async json(response, max = 131072) {
    const text = await response.text();
    if (text.length > max) throw Error("Oversized sync metadata");
    try {
      return JSON.parse(text);
    } catch {
      throw Error("Invalid sync metadata");
    }
  }
  async verify(signal) {
    if (this.verified) return;
    const name = "probes/" + crypto.randomUUID() + ".json";
    try {
      await this.probe(name, signal);
    } finally {
      try {
        await this.request(name, { method: "DELETE", signal });
      } catch {
      }
    }
  }
  async probe(name, signal) {
    let r = await this.request(name, { method: "PUT", body: { probe: 1 }, create: true, signal });
    if (!r.ok) throw Error("QStorage sync check HTTP " + r.status);
    let tag = this.etag(r);
    r = await this.request(name, { method: "PUT", body: { probe: 2 }, create: true, signal });
    if (r.status !== 412) {
      if (r.ok || [405, 501].includes(r.status)) throw new SyncUnavailable("QStorage does not enforce conditional create; automatic sync is unavailable");
      throw Error("QStorage conditional create check HTTP " + r.status);
    }
    r = await this.request(name, { method: "PUT", body: { probe: 3 }, etag: '"qvault-stale-etag"', signal });
    if (r.status !== 412) {
      if (r.ok || [405, 501].includes(r.status)) throw new SyncUnavailable("QStorage does not enforce conditional update; automatic sync is unavailable");
      throw Error("QStorage conditional update check HTTP " + r.status);
    }
    r = await this.request(name, { method: "PUT", body: { probe: 4 }, etag: tag, signal });
    if (!r.ok) throw Error("QStorage conditional update check failed");
    const current = this.etag(r);
    r = await this.request(name, { method: "PUT", body: { probe: 5 }, etag: tag, signal });
    if (r.status !== 412) {
      if (r.ok) throw new SyncUnavailable("QStorage accepts stale updates; automatic sync is unavailable");
      throw Error("QStorage stale update check HTTP " + r.status);
    }
    r = await this.request(name, { signal });
    if (!r.ok || this.etag(r) !== current || (await this.json(r)).probe !== 4) throw Error("QStorage sync readback check failed");
    this.verified = true;
  }
  aad() {
    return new TextEncoder().encode(JSON.stringify({ format: FORMAT, profileId: this.profileId, keyId: this.keyId }));
  }
  async encode(state) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    try {
      return { format: FORMAT, profileId: this.profileId, keyId: this.keyId, nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: this.aad() }, this.handle.key, bytes))) };
    } finally {
      bytes.fill(0);
    }
  }
  async decode(record) {
    if (record.format !== FORMAT || record.profileId !== this.profileId || record.keyId !== this.keyId || fromBase64(record.nonce, 12).length !== 12) throw Error("Unexpected cloud sync head");
    let bytes;
    try {
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(record.nonce), additionalData: this.aad() }, this.handle.key, fromBase64(record.ciphertext, 65536)));
      const s = JSON.parse(new TextDecoder().decode(bytes));
      if (s.version !== 1 || !/^[a-f0-9-]{36}$/.test(s.revision) || !Number.isSafeInteger(s.generation) || s.generation < 1 || !s.applied || typeof s.applied !== "object" || Array.isArray(s.applied) || Object.keys(s.applied).length > 128) throw Error();
      for (const [id, n] of Object.entries(s.applied)) if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(n) || n < 1) throw Error();
      if (s.reference && (!s.reference.object?.startsWith("qvault/" + this.profileId + "/") || !/^[-a-zA-Z0-9/._]+$/.test(s.reference.object))) throw Error();
      return s;
    } catch {
      throw Error("Cloud sync head authentication/format check failed");
    } finally {
      bytes?.fill(0);
    }
  }
  async readHead(signal) {
    const r = await this.request("head.json", { signal });
    if (r.status === 404) return null;
    if (!r.ok) throw Error("QStorage sync read HTTP " + r.status);
    return { etag: this.etag(r), state: await this.decode(await this.json(r)) };
  }
  async publish(expected, state, signal) {
    const body = await this.encode(state);
    let r;
    try {
      r = await this.request("head.json", { method: "PUT", body, etag: expected?.etag, create: !expected, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      const found = await this.readHead(signal);
      if (found?.state.revision === state.revision) return found;
      throw Error("Cloud save outcome is unknown. Pending changes are retained for retry.");
    }
    if (r.status === 412) throw new SyncConflict();
    if (!r.ok) throw Error("QStorage sync publish HTTP " + r.status);
    return { etag: this.etag(r), state };
  }
  async withMpcLease(fn, { signal, onLost = () => {
  } } = {}) {
    await this.verify(signal);
    const owner = crypto.randomUUID(), started = this.now();
    let owned = null;
    while (!owned) {
      if (signal?.aborted) throw Error("Vault locked");
      if (this.now() - started > this.leaseWaitMs) throw Error("Another device is using the QKMS key. Sync will retry.");
      const r = await this.request("mpc-lease.json", { signal });
      let previous = null, serverTime;
      if (r.status === 404) {
        serverTime = Date.parse(r.headers.get("date"));
      } else {
        if (!r.ok) throw Error("QStorage key lease HTTP " + r.status);
        previous = { etag: this.etag(r), body: await this.json(r, 4096) };
        serverTime = Date.parse(r.headers.get("date"));
        if (typeof previous.body.owner !== "string" || !Number.isFinite(previous.body.expiresAt)) throw Error("Invalid key-operation lease");
      }
      if (!Number.isFinite(serverTime)) throw Error("QStorage server time is required for safe key-operation leases");
      if (previous && previous.body.expiresAt > serverTime) {
        await sleep(400 + Math.random() * 400, signal);
        continue;
      }
      const body = { owner, expiresAt: serverTime + this.leaseTtlMs };
      const put = await this.request("mpc-lease.json", { method: "PUT", body, etag: previous?.etag, create: !previous, signal });
      if (put.status === 412) continue;
      if (!put.ok) throw Error("QStorage lease acquire HTTP " + put.status);
      owned = { etag: this.etag(put), body };
    }
    const guard = new AbortController();
    let lost = false;
    const timer = setTimeout(() => {
      lost = true;
      guard.abort();
      onLost();
    }, this.operationMs);
    try {
      return await fn(AbortSignal.any([guard.signal, ...signal ? [signal] : []]));
    } finally {
      clearTimeout(timer);
      if (!lost) try {
        const r = await this.request("mpc-lease.json");
        if (r.ok) {
          const current = await this.json(r, 4096);
          if (current.owner === owner) await this.request("mpc-lease.json", { method: "PUT", etag: this.etag(r), body: { owner, expiresAt: 0 } });
        }
      } catch {
      }
    }
  }
};

// src/storage-config.js
function validateStorageCredentials(value) {
  if (!value || typeof value.accessKey !== "string" || !value.accessKey || typeof value.secretKey !== "string" || !value.secretKey || typeof value.region !== "string" || !/^[-a-z0-9]{1,64}$/.test(value.region) || typeof value.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket)) throw Error("Invalid saved cloud storage settings");
  return value;
}
var storageCredentialsFor = (payload) => validateStorageCredentials(payload.storageCredentials || payload.credentials);

// src/cloud-vault.js
var FORMAT3 = "qvault-passwords-v1";
var FORMAT22 = "qvault-passwords-v2";
var MAX2 = 1024 * 1024;
var enc = new TextEncoder();
function location(credentials2, profileId, object) {
  if (!/^[a-f0-9-]{36}$/.test(profileId) || typeof object !== "string" || !object.startsWith("qvault/" + profileId + "/") || !/^[a-zA-Z0-9/._-]+$/.test(object) || object.split("/").some((s) => s === "" || s === "." || s === "..")) throw Error("Invalid cloud vault reference");
  return "https://qstorage.quilibrium.com/" + credentials2.bucket + "/" + object;
}
function client(c) {
  return new AwsClient({ accessKeyId: c.accessKey, secretAccessKey: c.secretKey, service: "s3", region: c.region, retries: 0 });
}
function aad(profileId, keyId2, object, format = FORMAT3) {
  return enc.encode(JSON.stringify({ format, profileId, keyId: keyId2, object }));
}
var wrapAad = (profileId, keyId2, object) => enc.encode(JSON.stringify({ format: FORMAT22, purpose: "key-wrap", profileId, keyId: keyId2, object }));
async function importLocalKey(localKey, usage) {
  let raw;
  try {
    raw = fromBase64(localKey, 32);
  } catch {
    throw Error("Invalid local vault key");
  }
  try {
    if (raw.length !== 32) throw Error("Invalid local vault key");
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
  } finally {
    raw.fill(0);
  }
}
function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 1e3) throw Error("Invalid password collection");
  const ids = /* @__PURE__ */ new Set();
  for (const e of entries) {
    if (!e || typeof e.id !== "string" || !/^[a-f0-9-]{36}$/.test(e.id) || ids.has(e.id)) throw Error("Invalid password entry");
    ids.add(e.id);
    for (const f of ["title", "url", "username", "password"]) if (typeof e[f] !== "string" || e[f].length > 4096) throw Error("Invalid password entry");
    if (e.url) {
      const u = new URL(e.url);
      if (u.protocol !== "https:") throw Error("Use an HTTPS website URL");
    }
    if (e.previous !== void 0 && (!e.previous || typeof e.previous.password !== "string" || e.previous.password.length > 4096 || typeof e.previous.at !== "string" || e.previous.at.length > 40)) throw Error("Invalid password entry");
  }
  return entries;
}
var cached = async (cache, object) => {
  try {
    const text = await cache?.get?.(object);
    return typeof text === "string" && text.length <= MAX2 * 2 ? text : null;
  } catch {
    return null;
  }
};
var remember = async (cache, object, text) => {
  try {
    await cache?.put?.(object, text);
  } catch {
  }
};
async function saveCloudVault({ credentials: credentials2, profileId, keyId: keyId2, entries, peer: peer2, signal, localKey, cache, check = () => {
} }) {
  validateEntries(entries);
  const object = "qvault/" + profileId + "/" + crypto.randomUUID() + ".json";
  const bytes = enc.encode(JSON.stringify({ version: 1, entries }));
  if (bytes.length > MAX2) throw Error("Password collection is too large");
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const format = localKey === void 0 ? FORMAT3 : FORMAT22;
  let inner = null;
  try {
    check();
    if (format === FORMAT22) {
      const local = await importLocalKey(localKey, "encrypt"), wrapNonce = crypto.getRandomValues(new Uint8Array(12));
      inner = new Uint8Array(60);
      inner.set(wrapNonce);
      inner.set(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapNonce, additionalData: wrapAad(profileId, keyId2, object) }, local, keyBytes)), 12);
      check();
    }
    const wrapped = await peer2.call("encrypt", { keyId: keyId2, value: toBase64(inner || keyBytes) });
    check();
    if (typeof wrapped.CiphertextBlob !== "string") throw Error("QKMS returned no wrapped key");
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId, keyId2, object, format) }, key, bytes));
    check();
    const body = JSON.stringify({ format, profileId, keyId: keyId2, wrappedKey: wrapped.CiphertextBlob, nonce: toBase64(nonce), ciphertext: toBase64(cipher) });
    const response = await client(credentials2).fetch(location(credentials2, profileId, object), { method: "PUT", body, headers: { "Content-Type": "application/json", "If-None-Match": "*" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6e4)]) });
    check();
    if (!response.ok) throw Error("QStorage save HTTP " + response.status);
    await remember(cache, object, body);
    return { object };
  } finally {
    keyBytes.fill(0);
    bytes.fill(0);
    inner?.fill(0);
  }
}
async function loadCloudVault({ credentials: credentials2, profileId, keyId: keyId2, reference, peer: peer2, signal, localKey, cache, check = () => {
} }) {
  if (!reference) return [];
  check();
  location(credentials2, profileId, reference.object);
  const download = async () => {
    const response = await client(credentials2).fetch(location(credentials2, profileId, reference.object), { method: "GET", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(6e4)]) });
    check();
    if (!response.ok) throw Error("QStorage read HTTP " + response.status);
    const text2 = await response.text();
    check();
    if (text2.length > MAX2 * 2) throw Error("Cloud vault is too large");
    return text2;
  };
  const local = await cached(cache, reference.object);
  check();
  if (local !== null) {
    try {
      return await openSnapshot(local, { profileId, keyId: keyId2, reference, peer: peer2, localKey, check });
    } catch {
      check();
    }
  }
  const text = await download(), entries = await openSnapshot(text, { profileId, keyId: keyId2, reference, peer: peer2, localKey, check });
  await remember(cache, reference.object, text);
  return entries;
}
async function openSnapshot(text, { profileId, keyId: keyId2, reference, peer: peer2, localKey, check }) {
  const record = JSON.parse(text);
  const v2 = record.format === FORMAT22;
  if (localKey !== void 0 && record.format === FORMAT3) throw Error("This cloud snapshot is not protected by the local vault key. It was rejected.");
  if (v2 && localKey === void 0) throw Error("This cloud snapshot needs the local vault key from its profile.");
  if (!v2 && record.format !== FORMAT3 || record.profileId !== profileId || record.keyId !== keyId2 || typeof record.wrappedKey !== "string" || record.wrappedKey.length > 16384) throw Error("Unexpected cloud vault");
  const nonce = fromBase64(record.nonce, 12);
  if (nonce.length !== 12) throw Error("Invalid cloud vault nonce");
  const local = v2 ? await importLocalKey(localKey, "decrypt") : null;
  const unwrapped = await peer2.call("decrypt", { keyId: keyId2, value: record.wrappedKey });
  check();
  let keyBytes;
  if (v2) {
    const blob = fromBase64(unwrapped.Plaintext, 60);
    try {
      if (blob.length !== 60) throw Error();
      keyBytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(0, 12), additionalData: wrapAad(profileId, keyId2, reference.object) }, local, blob.subarray(12)));
    } catch {
      throw Error("The local vault key does not open this cloud snapshot.");
    } finally {
      blob.fill(0);
    }
  } else keyBytes = fromBase64(unwrapped.Plaintext, 32);
  if (keyBytes.length !== 32) throw Error("Invalid recovered vault key");
  let bytes;
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(profileId, keyId2, reference.object, record.format) }, key, fromBase64(record.ciphertext, MAX2 + 16)));
    check();
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload.version !== 1) throw Error("Unsupported password collection");
    return validateEntries(payload.entries);
  } finally {
    keyBytes.fill(0);
    bytes?.fill(0);
  }
}

// src/sync-merge.js
var fields = ["title", "url", "username", "password"];
var canonical = (e) => e ? JSON.stringify([e.id, ...fields.map((k) => e[k])]) : "null";
function sameEntries(a, b) {
  return JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id)).map(canonical)) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)).map(canonical));
}
async function copy(local, remote) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("qvault-conflict-v1|" + canonical(local) + "|" + canonical(remote))));
  bytes[6] = bytes[6] & 15 | 80;
  bytes[8] = bytes[8] & 63 | 128;
  const h = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return { ...local, id: [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-"), title: local.title.slice(0, 4e3) + " (conflict copy)" };
}
async function mergeEntries(base, local, remote) {
  for (const list of [base, local, remote]) validateEntries(list);
  const maps = [base, local, remote].map((a) => new Map(a.map((e) => [e.id, e]))), result = /* @__PURE__ */ new Map(), conflicts = [];
  for (const id of /* @__PURE__ */ new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])) {
    const [b, l, r] = maps.map((m) => m.get(id) || null);
    const put = (e) => {
      if (e) result.set(e.id, { ...e });
    };
    if (canonical(l) === canonical(b)) {
      put(r);
      continue;
    }
    if (canonical(r) === canonical(b) || canonical(l) === canonical(r)) {
      put(l);
      continue;
    }
    if (!l) {
      put(r);
      conflicts.push({ entryId: id, type: "delete-versus-edit" });
      continue;
    }
    if (!r) {
      put(await copy(l, null));
      conflicts.push({ entryId: id, type: "edit-versus-delete" });
      continue;
    }
    if (b) {
      const merged = { ...r };
      let collision = false;
      for (const f of fields) {
        if (l[f] === b[f]) continue;
        if (r[f] === b[f] || l[f] === r[f]) merged[f] = l[f];
        else collision = true;
      }
      if (!collision) {
        put(merged);
        continue;
      }
    }
    put(r);
    put(await copy(l, r));
    conflicts.push({ entryId: id, type: "conflicting-edit" });
  }
  const entries = [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
  validateEntries(entries);
  return { entries, conflicts };
}

// src/sync-session.js
var SyncSession = class {
  constructor({ transport, cache, store, recordRevision, handle: handle2, payload, deviceId, peer: peer2, withMpc, check = () => {
  }, signal, onLost = () => {
  }, load = loadCloudVault, save = saveCloudVault }) {
    Object.assign(this, { transport, cache, store, recordRevision, handle: handle2, payload, deviceId, peer: peer2, withMpc, check, signal, onLost, load, save });
    this.entries = null;
    this.head = null;
    this.conflicts = [];
  }
  args() {
    return { credentials: storageCredentialsFor(this.payload), profileId: this.handle.profileId, keyId: this.payload.keyId, localKey: this.payload.localKey, cache: this.cache, peer: this.peer, signal: this.signal, check: this.check };
  }
  floor(head) {
    const old = this.payload.sync;
    if (old?.generation && head.state.generation < old.generation) throw Error("Cloud sync rollback detected");
    if (old?.generation === head.state.generation && old.revision !== head.state.revision) throw Error("Cloud sync history changed unexpectedly");
  }
  async readHead() {
    let head = await this.transport.readHead(this.signal);
    this.check();
    if (!head) {
      if (this.payload.sync?.generation) throw Error("Cloud sync head is missing; previous state was not reset");
      const state = { version: 1, revision: crypto.randomUUID(), generation: 1, reference: this.payload.vault ?? null, applied: {} };
      try {
        head = await this.transport.publish(null, state, this.signal);
      } catch (e) {
        if (!(e instanceof SyncConflict)) throw e;
        head = await this.transport.readHead(this.signal);
        if (!head) throw Error("Cloud sync initialization race; retry");
      }
    }
    this.floor(head);
    return head;
  }
  async readEntries(head) {
    if (this.entries && this.head?.state.reference?.object === head.state.reference?.object) return this.entries;
    if (!head.state.reference) return [];
    const result = await this.transport.withMpcLease((leaseSignal) => this.withMpc((peer2, signal) => this.load({ ...this.args(), reference: head.state.reference, peer: peer2, signal }), leaseSignal), { signal: this.signal, onLost: this.onLost });
    this.check();
    return result;
  }
  async persist(payload) {
    const record = await sealProfile(payload, this.handle);
    this.check();
    await this.store.save(record, this.recordRevision);
    this.check();
    this.recordRevision = record.revision;
    this.payload = payload;
  }
  async adopt(head, entries, clearPending = false) {
    const sync = { ...this.payload.sync, generation: head.state.generation, revision: head.state.revision };
    if (clearPending) delete sync.pending;
    await this.persist({ ...this.payload, vault: head.state.reference, sync });
    this.head = head;
    this.entries = entries;
    return entries;
  }
  async init() {
    await this.transport.verify(this.signal);
    this.check();
    if (this.payload.sync?.pending) return this.flush();
    return this.pull();
  }
  async pull() {
    const head = await this.readHead();
    if (this.head?.etag === head.etag) return this.entries;
    const entries = await this.readEntries(head);
    return this.adopt(head, entries);
  }
  async commit(entries, base = this.entries) {
    validateEntries(entries);
    validateEntries(base);
    if (this.payload.sync?.pending) await this.flush();
    const counter = Math.max(this.payload.sync?.counter || 0, this.head?.state.applied[this.deviceId] || 0) + 1;
    const pending = { device: this.deviceId, sequence: counter, base, entries };
    await this.persist({ ...this.payload, sync: { ...this.payload.sync, counter, pending } });
    return this.flush();
  }
  async flush() {
    const pending = this.payload.sync?.pending;
    if (!pending) return this.pull();
    if (!/^[a-f0-9-]{36}$/.test(pending.device) || !Number.isSafeInteger(pending.sequence) || pending.sequence < 1) throw Error("Invalid pending sync change");
    validateEntries(pending.base);
    validateEntries(pending.entries);
    for (let attempt = 0; attempt < 6; attempt++) {
      this.check();
      const head = await this.readHead();
      const remote = await this.readEntries(head);
      if ((head.state.applied[pending.device] || 0) >= pending.sequence) {
        await this.adopt(head, remote, true);
        return this.entries;
      }
      const merged = await mergeEntries(pending.base, pending.entries, remote);
      this.check();
      const reference = sameEntries(merged.entries, remote) ? head.state.reference : await this.save({ ...this.args(), entries: merged.entries });
      this.check();
      const applied = { ...head.state.applied, [pending.device]: pending.sequence };
      if (Object.keys(applied).length > 128) throw Error("Too many linked device identities for this sync format");
      const next = { version: 1, revision: crypto.randomUUID(), generation: head.state.generation + 1, reference, applied, parent: head.state.revision };
      try {
        const published = await this.transport.publish(head, next, this.signal);
        this.check();
        this.conflicts = merged.conflicts;
        await this.adopt(published, merged.entries, true);
        return this.entries;
      } catch (e) {
        if (!(e instanceof SyncConflict)) throw e;
      }
    }
    throw Error("Other devices are saving repeatedly. Pending changes remain protected and will retry.");
  }
  async sync() {
    return this.payload.sync?.pending ? this.flush() : this.pull();
  }
  // Best-effort cloud housekeeping after a save; never affects the save itself.
  async prune() {
    try {
      if (typeof this.transport?.pruneSnapshots !== "function") return null;
      return await this.transport.pruneSnapshots({ protect: [this.payload?.vault?.object, this.head?.state?.reference?.object], signal: this.signal });
    } catch {
      return null;
    }
  }
  close() {
    this.entries = null;
    this.handle = null;
    this.head = null;
    this.payload = null;
  }
};

// tests/fixture-profile.js
function fixtureSecret(label) {
  const out = new Uint8Array(32);
  let h = 2166136261;
  for (let round = 0; round < 4; round++) for (const c of String(label)) {
    h ^= c.charCodeAt(0) + round;
    h = Math.imul(h, 16777619) >>> 0;
    out[(h >>> 8) % 32] ^= h & 255;
    out[(h >>> 16) % 32] ^= h >>> 24 & 255;
  }
  for (let i = 0; i < 32; i++) {
    h ^= out[i] + i;
    h = Math.imul(h, 16777619) >>> 0;
    out[i] ^= h & 255;
  }
  return { prf: out };
}
async function fixtureProfile(label) {
  return createPasskeyProfile({ prf: fixtureSecret(label).prf, credentialId: toBase64(crypto.getRandomValues(new Uint8Array(20))), prfSalt: toBase64(crypto.getRandomValues(new Uint8Array(32))) });
}
async function fixtureKey(label) {
  return (await fixtureProfile(label)).handle;
}

// tests/sync-source.js
var savedFetch = globalThis.fetch;
var objects = /* @__PURE__ */ new Map();
var sequence = 0;
var ignoreConditions = false;
var lostAck = false;
var mpcActive = 0;
var maxMpc = 0;
globalThis.fetch = async (request) => {
  assert.ok(request instanceof Request);
  assert.equal(new URL(request.url).origin, "https://qstorage.quilibrium.com");
  assert.ok(request.headers.has("authorization"));
  const path = new URL(request.url).pathname, current = objects.get(path), headers = { "Date": (/* @__PURE__ */ new Date()).toUTCString() };
  if (request.method === "GET") return current ? new Response(current.body, { headers: { ...headers, ETag: current.etag } }) : new Response("", { status: 404, headers });
  assert.equal(request.method, "PUT");
  const body = await request.text();
  if (!ignoreConditions && (request.headers.get("if-none-match") === "*" && current || request.headers.has("if-match") && request.headers.get("if-match") !== current?.etag)) return new Response("", { status: 412, headers });
  const etag = '"fixture-' + ++sequence + '"';
  objects.set(path, { body, etag });
  if (lostAck && path.endsWith("/head.json")) {
    lostAck = false;
    throw Error("Synthetic lost acknowledgement");
  }
  return new Response("", { headers: { ...headers, ETag: etag } });
};
var handle = await fixtureKey("fictional sync passkey label");
var credentials = { accessKey: "FICTIONAL_SYNC_ACCESS", secretKey: "FICTIONAL_SYNC_SECRET", region: "q-world-1", bucket: "fictional-bucket" };
var keyId = "fictional-sync-key";
var pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["encrypt", "decrypt"]);
var peer = { call: async (action, m) => {
  assert.equal(m.keyId, keyId);
  if (action === "encrypt") return { CiphertextBlob: Buffer.from(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, Buffer.from(m.value, "base64"))).toString("base64") };
  if (action === "decrypt") return { Plaintext: Buffer.from(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, pair.privateKey, Buffer.from(m.value, "base64"))).toString("base64") };
  throw Error("Unexpected RPC");
} };
var initial = { version: 1, credentials, keyId, vault: null };
var backup = await sealProfile(initial, handle);
var stores = [];
async function device(record = backup, store) {
  store ??= new ProfileStore(new FDBFactory_default());
  if (!await store.read()) await store.save(record);
  const current = await store.read(), opened = await openProfile(current, fixtureSecret("fictional sync passkey label"));
  const deviceId = await store.getDeviceId();
  stores.push(store);
  const transport = new SyncTransport({ credentials, profileId: handle.profileId, keyId, handle: opened.handle, leaseWaitMs: 3e3 });
  const session = new SyncSession({ transport, store, recordRevision: current.revision, handle: opened.handle, payload: opened.payload, deviceId, peer, signal: new AbortController().signal, withMpc: async (fn, signal) => {
    mpcActive++;
    maxMpc = Math.max(maxMpc, mpcActive);
    try {
      await new Promise((r) => setTimeout(r, 10));
      return await fn(peer, signal);
    } finally {
      mpcActive--;
    }
  } });
  await session.init();
  return session;
}
var entry = (title) => ({ id: crypto.randomUUID(), title, url: "https://example.test", username: "FICTIONAL_USER_" + title, password: "FICTIONAL_PASS_" + title });
try {
  const a = await device(), b = await device();
  assert.notEqual(a.deviceId, b.deviceId);
  const one = entry("one"), two = entry("two");
  await Promise.all([a.commit([one]), b.commit([two])]);
  await Promise.all([a.sync(), b.sync()]);
  assert.equal(a.entries.length, 2);
  assert.ok(sameEntries(a.entries, b.entries));
  const edit = (s, patch) => s.entries.map((e) => e.id === one.id ? { ...e, ...patch } : e);
  await Promise.all([a.commit(edit(a, { username: "left-user" })), b.commit(edit(b, { password: "right-password" }))]);
  await Promise.all([a.sync(), b.sync()]);
  assert.deepEqual(a.entries.find((e) => e.id === one.id), { ...one, username: "left-user", password: "right-password" });
  await Promise.all([a.commit(edit(a, { password: "left-conflict" })), b.commit(edit(b, { password: "right-conflict" }))]);
  await Promise.all([a.sync(), b.sync()]);
  assert.ok(a.entries.some((e) => e.password === "left-conflict"));
  assert.ok(a.entries.some((e) => e.password === "right-conflict"));
  assert.equal(a.entries.length, 3);
  assert.ok(sameEntries(a.entries, b.entries));
  const fromOldBackup = await device(backup);
  assert.ok(sameEntries(fromOldBackup.entries, a.entries));
  await Promise.all([a.commit(a.entries.filter((e) => e.id !== one.id)), b.commit(edit(b, { username: "edited-during-delete" }))]);
  await Promise.all([a.sync(), b.sync()]);
  assert.ok(a.entries.some((e) => e.username === "edited-during-delete"));
  assert.ok(sameEntries(a.entries, b.entries));
  lostAck = true;
  await a.commit([...a.entries, entry("lost-ack")]);
  assert.equal(a.payload.sync.pending, void 0);
  const originalSave = a.store.save.bind(a.store);
  let writes = 0;
  a.store.save = async (...args) => {
    writes++;
    if (writes === 2) throw Error("Synthetic local commit failure");
    return originalSave(...args);
  };
  const pendingEntry = entry("outbox");
  await assert.rejects(() => a.commit([...a.entries, pendingEntry]), /local commit/);
  a.store.save = originalSave;
  assert.ok((await openProfile(await a.store.read(), fixtureSecret("fictional sync passkey label"))).payload.sync.pending);
  await b.sync();
  await b.commit(b.entries.map((e) => e.id === pendingEntry.id ? { ...e, password: "later-password" } : e));
  const recovered = await device(await a.store.read(), a.store);
  assert.equal(recovered.entries.find((e) => e.id === pendingEntry.id).password, "later-password");
  assert.equal(recovered.entries.filter((e) => e.title.startsWith("outbox")).length, 1);
  assert.equal(recovered.payload.sync.pending, void 0);
  const tag = (await recovered.transport.readHead()).etag;
  const headPath = "/fictional-bucket/qvault/" + handle.profileId + "/sync/v1/head.json";
  const raw = objects.get(headPath), damaged = JSON.parse(raw.body);
  damaged.ciphertext = "AAAA" + damaged.ciphertext.slice(4);
  objects.set(headPath, { ...raw, body: JSON.stringify(damaged) });
  await assert.rejects(() => recovered.transport.readHead(), /authentication/);
  objects.set(headPath, raw);
  assert.equal(maxMpc, 1);
  for (const obj of objects.values()) assert.ok(!obj.body.includes("FICTIONAL_PASS_"));
  ignoreConditions = true;
  const unsafe = new SyncTransport({ credentials, profileId: crypto.randomUUID(), keyId, handle });
  await assert.rejects(() => unsafe.verify(), /conditional create/);
  ignoreConditions = false;
  const merge = await mergeEntries([one], [{ ...one, password: "L" }], [{ ...one, password: "R" }]);
  const again = await mergeEntries([one], [{ ...one, password: "L" }], [{ ...one, password: "R" }]);
  assert.ok(sameEntries(merge.entries, again.entries));
  console.log("PASS LOCAL: two-device automatic latest-head discovery, atomic concurrent saves, disjoint-field merge, preserved conflicting edits/delete-vs-edit, old-backup latest restore, lost ACK recovery, durable outbox exactly-once replay after local failure, authenticated head tamper rejection, MPC lease mutual exclusion and conditional-write-unsupported fail-closed. Real crypto/signed HTTP and fake IndexedDB/S3/QKMS only.");
} finally {
  globalThis.fetch = savedFetch;
}
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
