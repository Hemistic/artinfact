"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/pend/index.js
var require_pend = __commonJS({
  "node_modules/pend/index.js"(exports2, module2) {
    module2.exports = Pend;
    function Pend() {
      this.pending = 0;
      this.max = Infinity;
      this.listeners = [];
      this.waiting = [];
      this.error = null;
    }
    Pend.prototype.go = function(fn) {
      if (this.pending < this.max) {
        pendGo(this, fn);
      } else {
        this.waiting.push(fn);
      }
    };
    Pend.prototype.wait = function(cb) {
      if (this.pending === 0) {
        cb(this.error);
      } else {
        this.listeners.push(cb);
      }
    };
    Pend.prototype.hold = function() {
      return pendHold(this);
    };
    function pendHold(self) {
      self.pending += 1;
      var called = false;
      return onCb;
      function onCb(err) {
        if (called) throw new Error("callback called twice");
        called = true;
        self.error = self.error || err;
        self.pending -= 1;
        if (self.waiting.length > 0 && self.pending < self.max) {
          pendGo(self, self.waiting.shift());
        } else if (self.pending === 0) {
          var listeners = self.listeners;
          self.listeners = [];
          listeners.forEach(cbListener);
        }
      }
      function cbListener(listener) {
        listener(self.error);
      }
    }
    function pendGo(self, fn) {
      fn(pendHold(self));
    }
  }
});

// node_modules/yauzl/fd-slicer.js
var require_fd_slicer = __commonJS({
  "node_modules/yauzl/fd-slicer.js"(exports2) {
    var fs2 = require("fs");
    var util = require("util");
    var stream = require("stream");
    var Readable = stream.Readable;
    var Writable = stream.Writable;
    var PassThrough = stream.PassThrough;
    var Pend = require_pend();
    var EventEmitter = require("events").EventEmitter;
    exports2.createFromBuffer = createFromBuffer;
    exports2.createFromFd = createFromFd;
    exports2.BufferSlicer = BufferSlicer;
    exports2.FdSlicer = FdSlicer;
    util.inherits(FdSlicer, EventEmitter);
    function FdSlicer(fd, options2) {
      options2 = options2 || {};
      EventEmitter.call(this);
      this.fd = fd;
      this.pend = new Pend();
      this.pend.max = 1;
      this.refCount = 0;
      this.autoClose = !!options2.autoClose;
    }
    FdSlicer.prototype.read = function(buffer, offset, length, position, callback) {
      var self = this;
      self.pend.go(function(cb) {
        fs2.read(self.fd, buffer, offset, length, position, function(err, bytesRead, buffer2) {
          cb();
          callback(err, bytesRead, buffer2);
        });
      });
    };
    FdSlicer.prototype.write = function(buffer, offset, length, position, callback) {
      var self = this;
      self.pend.go(function(cb) {
        fs2.write(self.fd, buffer, offset, length, position, function(err, written, buffer2) {
          cb();
          callback(err, written, buffer2);
        });
      });
    };
    FdSlicer.prototype.createReadStream = function(options2) {
      return new ReadStream(this, options2);
    };
    FdSlicer.prototype.createWriteStream = function(options2) {
      return new WriteStream(this, options2);
    };
    FdSlicer.prototype.ref = function() {
      this.refCount += 1;
    };
    FdSlicer.prototype.unref = function() {
      var self = this;
      self.refCount -= 1;
      if (self.refCount > 0) return;
      if (self.refCount < 0) throw new Error("invalid unref");
      if (self.autoClose) {
        fs2.close(self.fd, onCloseDone);
      }
      function onCloseDone(err) {
        if (err) {
          self.emit("error", err);
        } else {
          self.emit("close");
        }
      }
    };
    util.inherits(ReadStream, Readable);
    function ReadStream(context, options2) {
      options2 = options2 || {};
      Readable.call(this, options2);
      this.context = context;
      this.context.ref();
      this.start = options2.start || 0;
      this.endOffset = options2.end;
      this.pos = this.start;
      this.destroyed = false;
    }
    ReadStream.prototype._read = function(n) {
      var self = this;
      if (self.destroyed) return;
      var toRead = Math.min(self._readableState.highWaterMark, n);
      if (self.endOffset != null) {
        toRead = Math.min(toRead, self.endOffset - self.pos);
      }
      if (toRead <= 0) {
        self.destroyed = true;
        self.push(null);
        self.context.unref();
        return;
      }
      self.context.pend.go(function(cb) {
        if (self.destroyed) return cb();
        var buffer = Buffer.allocUnsafe(toRead);
        fs2.read(self.context.fd, buffer, 0, toRead, self.pos, function(err, bytesRead) {
          if (err) {
            self.destroy(err);
          } else if (bytesRead === 0) {
            self.destroyed = true;
            self.push(null);
            self.context.unref();
          } else {
            self.pos += bytesRead;
            self.push(buffer.slice(0, bytesRead));
          }
          cb();
        });
      });
    };
    ReadStream.prototype.destroy = function(err) {
      if (this.destroyed) return;
      err = err || new Error("stream destroyed");
      this.destroyed = true;
      this.emit("error", err);
      this.context.unref();
    };
    util.inherits(WriteStream, Writable);
    function WriteStream(context, options2) {
      options2 = options2 || {};
      Writable.call(this, options2);
      this.context = context;
      this.context.ref();
      this.start = options2.start || 0;
      this.endOffset = options2.end == null ? Infinity : +options2.end;
      this.bytesWritten = 0;
      this.pos = this.start;
      this.destroyed = false;
      this.on("finish", this.destroy.bind(this));
    }
    WriteStream.prototype._write = function(buffer, encoding, callback) {
      var self = this;
      if (self.destroyed) return;
      if (self.pos + buffer.length > self.endOffset) {
        var err = new Error("maximum file length exceeded");
        err.code = "ETOOBIG";
        self.destroy();
        callback(err);
        return;
      }
      self.context.pend.go(function(cb) {
        if (self.destroyed) return cb();
        fs2.write(self.context.fd, buffer, 0, buffer.length, self.pos, function(err2, bytes) {
          if (err2) {
            self.destroy();
            cb();
            callback(err2);
          } else {
            self.bytesWritten += bytes;
            self.pos += bytes;
            self.emit("progress");
            cb();
            callback();
          }
        });
      });
    };
    WriteStream.prototype.destroy = function() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.context.unref();
    };
    util.inherits(BufferSlicer, EventEmitter);
    function BufferSlicer(buffer, options2) {
      EventEmitter.call(this);
      options2 = options2 || {};
      this.refCount = 0;
      this.buffer = buffer;
      this.maxChunkSize = options2.maxChunkSize || Number.MAX_SAFE_INTEGER;
    }
    BufferSlicer.prototype.read = function(buffer, offset, length, position, callback) {
      if (!(0 <= offset && offset <= buffer.length)) throw new RangeError("offset outside buffer: 0 <= " + offset + " <= " + buffer.length);
      if (position < 0) throw new RangeError("position is negative: " + position);
      if (offset + length > buffer.length) {
        length = buffer.length - offset;
      }
      if (position + length > this.buffer.length) {
        length = this.buffer.length - position;
      }
      if (length <= 0) {
        setImmediate(function() {
          callback(null, 0);
        });
        return;
      }
      this.buffer.copy(buffer, offset, position, position + length);
      setImmediate(function() {
        callback(null, length);
      });
    };
    BufferSlicer.prototype.write = function(buffer, offset, length, position, callback) {
      buffer.copy(this.buffer, position, offset, offset + length);
      setImmediate(function() {
        callback(null, length, buffer);
      });
    };
    BufferSlicer.prototype.createReadStream = function(options2) {
      options2 = options2 || {};
      var readStream = new PassThrough(options2);
      readStream.destroyed = false;
      readStream.start = options2.start || 0;
      readStream.endOffset = options2.end;
      readStream.pos = readStream.endOffset || this.buffer.length;
      var entireSlice = this.buffer.slice(readStream.start, readStream.pos);
      var offset = 0;
      while (true) {
        var nextOffset = offset + this.maxChunkSize;
        if (nextOffset >= entireSlice.length) {
          if (offset < entireSlice.length) {
            readStream.write(entireSlice.slice(offset, entireSlice.length));
          }
          break;
        }
        readStream.write(entireSlice.slice(offset, nextOffset));
        offset = nextOffset;
      }
      readStream.end();
      readStream.destroy = function() {
        readStream.destroyed = true;
      };
      return readStream;
    };
    BufferSlicer.prototype.createWriteStream = function(options2) {
      var bufferSlicer = this;
      options2 = options2 || {};
      var writeStream = new Writable(options2);
      writeStream.start = options2.start || 0;
      writeStream.endOffset = options2.end == null ? this.buffer.length : +options2.end;
      writeStream.bytesWritten = 0;
      writeStream.pos = writeStream.start;
      writeStream.destroyed = false;
      writeStream._write = function(buffer, encoding, callback) {
        if (writeStream.destroyed) return;
        var end = writeStream.pos + buffer.length;
        if (end > writeStream.endOffset) {
          var err = new Error("maximum file length exceeded");
          err.code = "ETOOBIG";
          writeStream.destroyed = true;
          callback(err);
          return;
        }
        buffer.copy(bufferSlicer.buffer, writeStream.pos, 0, buffer.length);
        writeStream.bytesWritten += buffer.length;
        writeStream.pos = end;
        writeStream.emit("progress");
        callback();
      };
      writeStream.destroy = function() {
        writeStream.destroyed = true;
      };
      return writeStream;
    };
    BufferSlicer.prototype.ref = function() {
      this.refCount += 1;
    };
    BufferSlicer.prototype.unref = function() {
      this.refCount -= 1;
      if (this.refCount < 0) {
        throw new Error("invalid unref");
      }
    };
    function createFromBuffer(buffer, options2) {
      return new BufferSlicer(buffer, options2);
    }
    function createFromFd(fd, options2) {
      return new FdSlicer(fd, options2);
    }
  }
});

// node_modules/buffer-crc32/index.js
var require_buffer_crc32 = __commonJS({
  "node_modules/buffer-crc32/index.js"(exports2, module2) {
    var Buffer2 = require("buffer").Buffer;
    var CRC_TABLE = [
      0,
      1996959894,
      3993919788,
      2567524794,
      124634137,
      1886057615,
      3915621685,
      2657392035,
      249268274,
      2044508324,
      3772115230,
      2547177864,
      162941995,
      2125561021,
      3887607047,
      2428444049,
      498536548,
      1789927666,
      4089016648,
      2227061214,
      450548861,
      1843258603,
      4107580753,
      2211677639,
      325883990,
      1684777152,
      4251122042,
      2321926636,
      335633487,
      1661365465,
      4195302755,
      2366115317,
      997073096,
      1281953886,
      3579855332,
      2724688242,
      1006888145,
      1258607687,
      3524101629,
      2768942443,
      901097722,
      1119000684,
      3686517206,
      2898065728,
      853044451,
      1172266101,
      3705015759,
      2882616665,
      651767980,
      1373503546,
      3369554304,
      3218104598,
      565507253,
      1454621731,
      3485111705,
      3099436303,
      671266974,
      1594198024,
      3322730930,
      2970347812,
      795835527,
      1483230225,
      3244367275,
      3060149565,
      1994146192,
      31158534,
      2563907772,
      4023717930,
      1907459465,
      112637215,
      2680153253,
      3904427059,
      2013776290,
      251722036,
      2517215374,
      3775830040,
      2137656763,
      141376813,
      2439277719,
      3865271297,
      1802195444,
      476864866,
      2238001368,
      4066508878,
      1812370925,
      453092731,
      2181625025,
      4111451223,
      1706088902,
      314042704,
      2344532202,
      4240017532,
      1658658271,
      366619977,
      2362670323,
      4224994405,
      1303535960,
      984961486,
      2747007092,
      3569037538,
      1256170817,
      1037604311,
      2765210733,
      3554079995,
      1131014506,
      879679996,
      2909243462,
      3663771856,
      1141124467,
      855842277,
      2852801631,
      3708648649,
      1342533948,
      654459306,
      3188396048,
      3373015174,
      1466479909,
      544179635,
      3110523913,
      3462522015,
      1591671054,
      702138776,
      2966460450,
      3352799412,
      1504918807,
      783551873,
      3082640443,
      3233442989,
      3988292384,
      2596254646,
      62317068,
      1957810842,
      3939845945,
      2647816111,
      81470997,
      1943803523,
      3814918930,
      2489596804,
      225274430,
      2053790376,
      3826175755,
      2466906013,
      167816743,
      2097651377,
      4027552580,
      2265490386,
      503444072,
      1762050814,
      4150417245,
      2154129355,
      426522225,
      1852507879,
      4275313526,
      2312317920,
      282753626,
      1742555852,
      4189708143,
      2394877945,
      397917763,
      1622183637,
      3604390888,
      2714866558,
      953729732,
      1340076626,
      3518719985,
      2797360999,
      1068828381,
      1219638859,
      3624741850,
      2936675148,
      906185462,
      1090812512,
      3747672003,
      2825379669,
      829329135,
      1181335161,
      3412177804,
      3160834842,
      628085408,
      1382605366,
      3423369109,
      3138078467,
      570562233,
      1426400815,
      3317316542,
      2998733608,
      733239954,
      1555261956,
      3268935591,
      3050360625,
      752459403,
      1541320221,
      2607071920,
      3965973030,
      1969922972,
      40735498,
      2617837225,
      3943577151,
      1913087877,
      83908371,
      2512341634,
      3803740692,
      2075208622,
      213261112,
      2463272603,
      3855990285,
      2094854071,
      198958881,
      2262029012,
      4057260610,
      1759359992,
      534414190,
      2176718541,
      4139329115,
      1873836001,
      414664567,
      2282248934,
      4279200368,
      1711684554,
      285281116,
      2405801727,
      4167216745,
      1634467795,
      376229701,
      2685067896,
      3608007406,
      1308918612,
      956543938,
      2808555105,
      3495958263,
      1231636301,
      1047427035,
      2932959818,
      3654703836,
      1088359270,
      936918e3,
      2847714899,
      3736837829,
      1202900863,
      817233897,
      3183342108,
      3401237130,
      1404277552,
      615818150,
      3134207493,
      3453421203,
      1423857449,
      601450431,
      3009837614,
      3294710456,
      1567103746,
      711928724,
      3020668471,
      3272380065,
      1510334235,
      755167117
    ];
    if (typeof Int32Array !== "undefined") {
      CRC_TABLE = new Int32Array(CRC_TABLE);
    }
    function ensureBuffer(input) {
      if (Buffer2.isBuffer(input)) {
        return input;
      }
      var hasNewBufferAPI = typeof Buffer2.alloc === "function" && typeof Buffer2.from === "function";
      if (typeof input === "number") {
        return hasNewBufferAPI ? Buffer2.alloc(input) : new Buffer2(input);
      } else if (typeof input === "string") {
        return hasNewBufferAPI ? Buffer2.from(input) : new Buffer2(input);
      } else {
        throw new Error("input must be buffer, number, or string, received " + typeof input);
      }
    }
    function bufferizeInt(num) {
      var tmp = ensureBuffer(4);
      tmp.writeInt32BE(num, 0);
      return tmp;
    }
    function _crc32(buf, previous) {
      buf = ensureBuffer(buf);
      if (Buffer2.isBuffer(previous)) {
        previous = previous.readUInt32BE(0);
      }
      var crc = ~~previous ^ -1;
      for (var n = 0; n < buf.length; n++) {
        crc = CRC_TABLE[(crc ^ buf[n]) & 255] ^ crc >>> 8;
      }
      return crc ^ -1;
    }
    function crc32() {
      return bufferizeInt(_crc32.apply(null, arguments));
    }
    crc32.signed = function() {
      return _crc32.apply(null, arguments);
    };
    crc32.unsigned = function() {
      return _crc32.apply(null, arguments) >>> 0;
    };
    module2.exports = crc32;
  }
});

// node_modules/yauzl/index.js
var require_yauzl = __commonJS({
  "node_modules/yauzl/index.js"(exports2) {
    var fs2 = require("fs");
    var zlib = require("zlib");
    var fd_slicer = require_fd_slicer();
    var crc32 = require_buffer_crc32();
    var util = require("util");
    var EventEmitter = require("events").EventEmitter;
    var Transform = require("stream").Transform;
    var PassThrough = require("stream").PassThrough;
    var Writable = require("stream").Writable;
    exports2.open = open;
    exports2.fromFd = fromFd;
    exports2.fromBuffer = fromBuffer;
    exports2.fromRandomAccessReader = fromRandomAccessReader;
    exports2.dosDateTimeToDate = dosDateTimeToDate;
    exports2.getFileNameLowLevel = getFileNameLowLevel;
    exports2.validateFileName = validateFileName;
    exports2.parseExtraFields = parseExtraFields;
    exports2.ZipFile = ZipFile;
    exports2.Entry = Entry;
    exports2.LocalFileHeader = LocalFileHeader;
    exports2.RandomAccessReader = RandomAccessReader;
    function open(path2, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = true;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      fs2.open(path2, "r", function(err, fd) {
        if (err) return callback(err);
        fromFd(fd, options2, function(err2, zipfile) {
          if (err2) fs2.close(fd, defaultCallback);
          callback(err2, zipfile);
        });
      });
    }
    function fromFd(fd, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = false;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      fs2.fstat(fd, function(err, stats) {
        if (err) return callback(err);
        var reader = fd_slicer.createFromFd(fd, { autoClose: true });
        fromRandomAccessReader(reader, stats.size, options2, callback);
      });
    }
    function fromBuffer(buffer, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      options2.autoClose = false;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      var reader = fd_slicer.createFromBuffer(buffer, { maxChunkSize: 65536 });
      fromRandomAccessReader(reader, buffer.length, options2, callback);
    }
    function fromRandomAccessReader(reader, totalSize, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = true;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      var decodeStrings = !!options2.decodeStrings;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      if (typeof totalSize !== "number") throw new Error("expected totalSize parameter to be a number");
      if (totalSize > Number.MAX_SAFE_INTEGER) {
        throw new Error("zip file too large. only file sizes up to 2^52 are supported due to JavaScript's Number type being an IEEE 754 double.");
      }
      reader.ref();
      var eocdrWithoutCommentSize = 22;
      var zip64EocdlSize = 20;
      var maxCommentSize = 65535;
      var bufferSize = Math.min(zip64EocdlSize + eocdrWithoutCommentSize + maxCommentSize, totalSize);
      var buffer = newBuffer(bufferSize);
      var bufferReadStart = totalSize - buffer.length;
      readAndAssertNoEof(reader, buffer, 0, bufferSize, bufferReadStart, function(err) {
        if (err) return callback(err);
        for (var i = bufferSize - eocdrWithoutCommentSize; i >= 0; i -= 1) {
          if (buffer.readUInt32LE(i) !== 101010256) continue;
          var eocdrBuffer = buffer.subarray(i);
          var diskNumber = eocdrBuffer.readUInt16LE(4);
          var entryCount = eocdrBuffer.readUInt16LE(10);
          var centralDirectoryOffset = eocdrBuffer.readUInt32LE(16);
          var commentLength = eocdrBuffer.readUInt16LE(20);
          var expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize;
          if (commentLength !== expectedCommentLength) {
            return callback(new Error("Invalid comment length. Expected: " + expectedCommentLength + ". Found: " + commentLength + ". Are there extra bytes at the end of the file? Or is the end of central dir signature `PK\u263A\u263B` in the comment?"));
          }
          var comment = decodeStrings ? decodeBuffer(eocdrBuffer.subarray(22), false) : eocdrBuffer.subarray(22);
          if (i - zip64EocdlSize >= 0 && buffer.readUInt32LE(i - zip64EocdlSize) === 117853008) {
            var zip64EocdlBuffer = buffer.subarray(i - zip64EocdlSize, i - zip64EocdlSize + zip64EocdlSize);
            var zip64EocdrOffset = readUInt64LE(zip64EocdlBuffer, 8);
            var zip64EocdrBuffer = newBuffer(56);
            return readAndAssertNoEof(reader, zip64EocdrBuffer, 0, zip64EocdrBuffer.length, zip64EocdrOffset, function(err2) {
              if (err2) return callback(err2);
              if (zip64EocdrBuffer.readUInt32LE(0) !== 101075792) {
                return callback(new Error("invalid zip64 end of central directory record signature"));
              }
              diskNumber = zip64EocdrBuffer.readUInt32LE(16);
              if (diskNumber !== 0) {
                return callback(new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
              }
              entryCount = readUInt64LE(zip64EocdrBuffer, 32);
              centralDirectoryOffset = readUInt64LE(zip64EocdrBuffer, 48);
              return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options2.autoClose, options2.lazyEntries, decodeStrings, options2.validateEntrySizes, options2.strictFileNames));
            });
          }
          if (diskNumber !== 0) {
            return callback(new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
          }
          return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options2.autoClose, options2.lazyEntries, decodeStrings, options2.validateEntrySizes, options2.strictFileNames));
        }
        callback(new Error("End of central directory record signature not found. Either not a zip file, or file is truncated."));
      });
    }
    util.inherits(ZipFile, EventEmitter);
    function ZipFile(reader, centralDirectoryOffset, fileSize, entryCount, comment, autoClose, lazyEntries, decodeStrings, validateEntrySizes, strictFileNames) {
      var self = this;
      EventEmitter.call(self);
      self.reader = reader;
      self.reader.on("error", function(err) {
        emitError(self, err);
      });
      self.reader.once("close", function() {
        self.emit("close");
      });
      self.readEntryCursor = centralDirectoryOffset;
      self.fileSize = fileSize;
      self.entryCount = entryCount;
      self.comment = comment;
      self.entriesRead = 0;
      self.autoClose = !!autoClose;
      self.lazyEntries = !!lazyEntries;
      self.decodeStrings = !!decodeStrings;
      self.validateEntrySizes = !!validateEntrySizes;
      self.strictFileNames = !!strictFileNames;
      self.isOpen = true;
      self.emittedError = false;
      if (!self.lazyEntries) self._readEntry();
    }
    ZipFile.prototype.close = function() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.reader.unref();
    };
    function emitErrorAndAutoClose(self, err) {
      if (self.autoClose) self.close();
      emitError(self, err);
    }
    function emitError(self, err) {
      if (self.emittedError) return;
      self.emittedError = true;
      self.emit("error", err);
    }
    ZipFile.prototype.readEntry = function() {
      if (!this.lazyEntries) throw new Error("readEntry() called without lazyEntries:true");
      this._readEntry();
    };
    ZipFile.prototype._readEntry = function() {
      var self = this;
      if (self.entryCount === self.entriesRead) {
        setImmediate(function() {
          if (self.autoClose) self.close();
          if (self.emittedError) return;
          self.emit("end");
        });
        return;
      }
      if (self.emittedError) return;
      var buffer = newBuffer(46);
      readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err) {
        if (err) return emitErrorAndAutoClose(self, err);
        if (self.emittedError) return;
        var entry = new Entry();
        var signature = buffer.readUInt32LE(0);
        if (signature !== 33639248) return emitErrorAndAutoClose(self, new Error("invalid central directory file header signature: 0x" + signature.toString(16)));
        entry.versionMadeBy = buffer.readUInt16LE(4);
        entry.versionNeededToExtract = buffer.readUInt16LE(6);
        entry.generalPurposeBitFlag = buffer.readUInt16LE(8);
        entry.compressionMethod = buffer.readUInt16LE(10);
        entry.lastModFileTime = buffer.readUInt16LE(12);
        entry.lastModFileDate = buffer.readUInt16LE(14);
        entry.crc32 = buffer.readUInt32LE(16);
        entry.compressedSize = buffer.readUInt32LE(20);
        entry.uncompressedSize = buffer.readUInt32LE(24);
        entry.fileNameLength = buffer.readUInt16LE(28);
        entry.extraFieldLength = buffer.readUInt16LE(30);
        entry.fileCommentLength = buffer.readUInt16LE(32);
        entry.internalFileAttributes = buffer.readUInt16LE(36);
        entry.externalFileAttributes = buffer.readUInt32LE(38);
        entry.relativeOffsetOfLocalHeader = buffer.readUInt32LE(42);
        if (entry.generalPurposeBitFlag & 64) return emitErrorAndAutoClose(self, new Error("strong encryption is not supported"));
        self.readEntryCursor += 46;
        buffer = newBuffer(entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength);
        readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err2) {
          if (err2) return emitErrorAndAutoClose(self, err2);
          if (self.emittedError) return;
          entry.fileNameRaw = buffer.subarray(0, entry.fileNameLength);
          var fileCommentStart = entry.fileNameLength + entry.extraFieldLength;
          entry.extraFieldRaw = buffer.subarray(entry.fileNameLength, fileCommentStart);
          entry.fileCommentRaw = buffer.subarray(fileCommentStart, fileCommentStart + entry.fileCommentLength);
          try {
            entry.extraFields = parseExtraFields(entry.extraFieldRaw);
          } catch (err3) {
            return emitErrorAndAutoClose(self, err3);
          }
          if (self.decodeStrings) {
            var isUtf8 = (entry.generalPurposeBitFlag & 2048) !== 0;
            entry.fileComment = decodeBuffer(entry.fileCommentRaw, isUtf8);
            entry.fileName = getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, self.strictFileNames);
            var errorMessage = validateFileName(entry.fileName);
            if (errorMessage != null) return emitErrorAndAutoClose(self, new Error(errorMessage));
          } else {
            entry.fileComment = entry.fileCommentRaw;
            entry.fileName = entry.fileNameRaw;
          }
          entry.comment = entry.fileComment;
          self.readEntryCursor += buffer.length;
          self.entriesRead += 1;
          for (var i = 0; i < entry.extraFields.length; i++) {
            var extraField = entry.extraFields[i];
            if (extraField.id !== 1) continue;
            var zip64EiefBuffer = extraField.data;
            var index = 0;
            if (entry.uncompressedSize === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include uncompressed size"));
              }
              entry.uncompressedSize = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            if (entry.compressedSize === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include compressed size"));
              }
              entry.compressedSize = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            if (entry.relativeOffsetOfLocalHeader === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include relative header offset"));
              }
              entry.relativeOffsetOfLocalHeader = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            break;
          }
          if (self.validateEntrySizes && entry.compressionMethod === 0) {
            var expectedCompressedSize = entry.uncompressedSize;
            if (entry.isEncrypted()) {
              expectedCompressedSize += 12;
            }
            if (entry.compressedSize !== expectedCompressedSize) {
              var msg = "compressed/uncompressed size mismatch for stored file: " + entry.compressedSize + " != " + entry.uncompressedSize;
              return emitErrorAndAutoClose(self, new Error(msg));
            }
          }
          self.emit("entry", entry);
          if (!self.lazyEntries) self._readEntry();
        });
      });
    };
    ZipFile.prototype.openReadStream = function(entry, options2, callback) {
      var self = this;
      var relativeStart = 0;
      var relativeEnd = entry.compressedSize;
      if (callback == null) {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) {
        options2 = {};
      } else {
        if (options2.decodeFileData === false) {
          if (options2.decrypt != null) {
            throw new Error("cannot use options.decrypt when options.decodeFileData === false");
          }
          if (options2.decompress != null) {
            throw new Error("cannot use options.decompress when options.decodeFileData === false");
          }
        } else {
          if (options2.decrypt != null) {
            if (!entry.isEncrypted()) {
              throw new Error("options.decrypt can only be specified for encrypted entries. See also option decodeFileData.");
            }
            if (options2.decrypt !== false) throw new Error("invalid options.decrypt value: " + options2.decrypt);
            if (entry.isCompressed()) {
              if (options2.decompress !== false) throw new Error("entry is encrypted and compressed, and options.decompress !== false. See also option decodeFileData.");
            }
          }
          if (options2.decompress != null) {
            if (!entry.isCompressed()) {
              throw new Error("options.decompress can only be specified for compressed entries. See also option decodeFileData.");
            }
            if (!(options2.decompress === false || options2.decompress === true)) {
              throw new Error("invalid options.decompress value: " + options2.decompress);
            }
            decompress = options2.decompress;
          }
        }
        if (options2.start != null) {
          relativeStart = options2.start;
          if (relativeStart < 0) throw new Error("options.start < 0");
          if (relativeStart > entry.compressedSize) throw new Error("options.start > entry.compressedSize");
        }
        if (options2.end != null) {
          relativeEnd = options2.end;
          if (relativeEnd < 0) throw new Error("options.end < 0");
          if (relativeEnd > entry.compressedSize) throw new Error("options.end > entry.compressedSize");
          if (relativeEnd < relativeStart) throw new Error("options.end < options.start");
        }
      }
      var rawMode = options2.decodeFileData === false || // Explicitly requested raw.
      (entry.compressionMethod === 0 || // Naturally without compression.
      entry.compressionMethod === 8 && options2.decompress === false) && (!entry.isEncrypted() || // Naturally without encryption.
      options2.decrypt === false);
      if (options2.start != null || options2.end != null) {
        if (!rawMode) throw new Error("start/end range require options.decodeFileData === false for non-trivial encoded entries.");
      }
      if (!self.isOpen) return callback(new Error("closed"));
      if (entry.isEncrypted() && !rawMode) {
        if (options2.decrypt !== false) return callback(new Error("entry is encrypted, and options.decodeFileData !== false"));
      }
      var decompress;
      if (rawMode) {
        decompress = false;
      } else if (entry.compressionMethod === 8) {
        decompress = options2.decodeFileData !== true;
      } else {
        return callback(new Error("unsupported compression method: " + entry.compressionMethod));
      }
      self.readLocalFileHeader(entry, { minimal: true }, function(err, localFileHeader) {
        if (err) return callback(err);
        self.openReadStreamLowLevel(
          localFileHeader.fileDataStart,
          entry.compressedSize,
          relativeStart,
          relativeEnd,
          decompress,
          entry.uncompressedSize,
          callback
        );
      });
    };
    ZipFile.prototype.openReadStreamLowLevel = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, callback) {
      var self = this;
      var fileDataEnd = fileDataStart + compressedSize;
      var readStream = self.reader.createReadStream({
        start: fileDataStart + relativeStart,
        end: fileDataStart + relativeEnd
      });
      var endpointStream = readStream;
      if (decompress) {
        var destroyed = false;
        var inflateFilter = zlib.createInflateRaw();
        readStream.on("error", function(err) {
          setImmediate(function() {
            if (!destroyed) inflateFilter.emit("error", err);
          });
        });
        readStream.pipe(inflateFilter);
        if (self.validateEntrySizes) {
          endpointStream = new AssertByteCountStream(uncompressedSize);
          inflateFilter.on("error", function(err) {
            setImmediate(function() {
              if (!destroyed) endpointStream.emit("error", err);
            });
          });
          inflateFilter.pipe(endpointStream);
        } else {
          endpointStream = inflateFilter;
        }
        installDestroyFn(endpointStream, function() {
          destroyed = true;
          if (inflateFilter !== endpointStream) inflateFilter.unpipe(endpointStream);
          readStream.unpipe(inflateFilter);
          readStream.destroy();
        });
      }
      callback(null, endpointStream);
    };
    ZipFile.prototype.readLocalFileHeader = function(entry, options2, callback) {
      var self = this;
      if (callback == null) {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      self.reader.ref();
      var buffer = newBuffer(30);
      readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader, function(err) {
        try {
          if (err) return callback(err);
          var signature = buffer.readUInt32LE(0);
          if (signature !== 67324752) {
            return callback(new Error("invalid local file header signature: 0x" + signature.toString(16)));
          }
          var fileNameLength = buffer.readUInt16LE(26);
          var extraFieldLength = buffer.readUInt16LE(28);
          var fileDataStart = entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;
          if (fileDataStart + entry.compressedSize > self.fileSize) {
            return callback(new Error("file data overflows file bounds: " + fileDataStart + " + " + entry.compressedSize + " > " + self.fileSize));
          }
          if (options2.minimal) {
            return callback(null, { fileDataStart });
          }
          var localFileHeader = new LocalFileHeader();
          localFileHeader.fileDataStart = fileDataStart;
          localFileHeader.versionNeededToExtract = buffer.readUInt16LE(4);
          localFileHeader.generalPurposeBitFlag = buffer.readUInt16LE(6);
          localFileHeader.compressionMethod = buffer.readUInt16LE(8);
          localFileHeader.lastModFileTime = buffer.readUInt16LE(10);
          localFileHeader.lastModFileDate = buffer.readUInt16LE(12);
          localFileHeader.crc32 = buffer.readUInt32LE(14);
          localFileHeader.compressedSize = buffer.readUInt32LE(18);
          localFileHeader.uncompressedSize = buffer.readUInt32LE(22);
          localFileHeader.fileNameLength = fileNameLength;
          localFileHeader.extraFieldLength = extraFieldLength;
          buffer = newBuffer(fileNameLength + extraFieldLength);
          self.reader.ref();
          readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader + 30, function(err2) {
            try {
              if (err2) return callback(err2);
              localFileHeader.fileName = buffer.subarray(0, fileNameLength);
              localFileHeader.extraField = buffer.subarray(fileNameLength);
              return callback(null, localFileHeader);
            } finally {
              self.reader.unref();
            }
          });
        } finally {
          self.reader.unref();
        }
      });
    };
    function Entry() {
    }
    Entry.prototype.getLastModDate = function(options2) {
      if (options2 == null) options2 = {};
      if (!options2.forceDosFormat) {
        for (var i = 0; i < this.extraFields.length; i++) {
          var extraField = this.extraFields[i];
          if (extraField.id === 21589) {
            var data = extraField.data;
            if (data.length < 5) continue;
            var flags = data[0];
            var HAS_MTIME = 1;
            if (!(flags & HAS_MTIME)) continue;
            var posixTimestamp = data.readInt32LE(1);
            return new Date(posixTimestamp * 1e3);
          } else if (extraField.id === 10) {
            var data = extraField.data;
            if (data.length !== 32) continue;
            if (data.readUInt16LE(4) !== 1) continue;
            if (data.readUInt16LE(6) !== 24) continue;
            var hundredNanoSecondsSince1601 = data.readUInt32LE(8) + 4294967296 * data.readInt32LE(12);
            var millisecondsSince1970 = hundredNanoSecondsSince1601 / 1e4 - 116444736e5;
            return new Date(millisecondsSince1970);
          }
        }
      }
      return dosDateTimeToDate(this.lastModFileDate, this.lastModFileTime, options2.timezone);
    };
    Entry.prototype.canDecodeFileData = function() {
      return !this.isEncrypted() && (this.compressionMethod === 0 || this.compressionMethod === 8);
    };
    Entry.prototype.isEncrypted = function() {
      return (this.generalPurposeBitFlag & 1) !== 0;
    };
    Entry.prototype.isCompressed = function() {
      return this.compressionMethod === 8;
    };
    function LocalFileHeader() {
    }
    function dosDateTimeToDate(date, time, timezone) {
      var day = date & 31;
      var month = (date >> 5 & 15) - 1;
      var year = (date >> 9 & 127) + 1980;
      var millisecond = 0;
      var second = (time & 31) * 2;
      var minute = time >> 5 & 63;
      var hour = time >> 11 & 31;
      if (timezone == null || timezone === "local") {
        return new Date(year, month, day, hour, minute, second, millisecond);
      } else if (timezone === "UTC") {
        return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
      } else {
        throw new Error("unrecognized options.timezone: " + options.timezone);
      }
    }
    function getFileNameLowLevel(generalPurposeBitFlag, fileNameBuffer, extraFields, strictFileNames) {
      var fileName = null;
      for (var i = 0; i < extraFields.length; i++) {
        var extraField = extraFields[i];
        if (extraField.id === 28789) {
          if (extraField.data.length < 6) {
            continue;
          }
          if (extraField.data.readUInt8(0) !== 1) {
            continue;
          }
          var oldNameCrc32 = extraField.data.readUInt32LE(1);
          if (crc32.unsigned(fileNameBuffer) !== oldNameCrc32) {
            continue;
          }
          fileName = decodeBuffer(extraField.data.subarray(5), true);
          break;
        }
      }
      if (fileName == null) {
        var isUtf8 = (generalPurposeBitFlag & 2048) !== 0;
        fileName = decodeBuffer(fileNameBuffer, isUtf8);
      }
      if (!strictFileNames) {
        fileName = fileName.replace(/\\/g, "/");
      }
      return fileName;
    }
    function validateFileName(fileName) {
      if (fileName.indexOf("\\") !== -1) {
        return "invalid characters in fileName: " + fileName;
      }
      if (/^[a-zA-Z]:/.test(fileName) || /^\//.test(fileName)) {
        return "absolute path: " + fileName;
      }
      if (fileName.split("/").indexOf("..") !== -1) {
        return "invalid relative path: " + fileName;
      }
      return null;
    }
    function parseExtraFields(extraFieldBuffer) {
      var extraFields = [];
      var i = 0;
      while (i < extraFieldBuffer.length - 3) {
        var headerId = extraFieldBuffer.readUInt16LE(i + 0);
        var dataSize = extraFieldBuffer.readUInt16LE(i + 2);
        var dataStart = i + 4;
        var dataEnd = dataStart + dataSize;
        if (dataEnd > extraFieldBuffer.length) throw new Error("extra field length exceeds extra field buffer size");
        var dataBuffer = extraFieldBuffer.subarray(dataStart, dataEnd);
        extraFields.push({
          id: headerId,
          data: dataBuffer
        });
        i = dataEnd;
      }
      return extraFields;
    }
    function readAndAssertNoEof(reader, buffer, offset, length, position, callback) {
      if (length === 0) {
        return setImmediate(function() {
          callback(null, newBuffer(0));
        });
      }
      reader.read(buffer, offset, length, position, function(err, bytesRead) {
        if (err) return callback(err);
        if (bytesRead < length) {
          return callback(new Error("unexpected EOF"));
        }
        callback();
      });
    }
    util.inherits(AssertByteCountStream, Transform);
    function AssertByteCountStream(byteCount) {
      Transform.call(this);
      this.actualByteCount = 0;
      this.expectedByteCount = byteCount;
    }
    AssertByteCountStream.prototype._transform = function(chunk, encoding, cb) {
      this.actualByteCount += chunk.length;
      if (this.actualByteCount > this.expectedByteCount) {
        var msg = "too many bytes in the stream. expected " + this.expectedByteCount + ". got at least " + this.actualByteCount;
        return cb(new Error(msg));
      }
      cb(null, chunk);
    };
    AssertByteCountStream.prototype._flush = function(cb) {
      if (this.actualByteCount < this.expectedByteCount) {
        var msg = "not enough bytes in the stream. expected " + this.expectedByteCount + ". got only " + this.actualByteCount;
        return cb(new Error(msg));
      }
      cb();
    };
    util.inherits(RandomAccessReader, EventEmitter);
    function RandomAccessReader() {
      EventEmitter.call(this);
      this.refCount = 0;
    }
    RandomAccessReader.prototype.ref = function() {
      this.refCount += 1;
    };
    RandomAccessReader.prototype.unref = function() {
      var self = this;
      self.refCount -= 1;
      if (self.refCount > 0) return;
      if (self.refCount < 0) throw new Error("invalid unref");
      self.close(onCloseDone);
      function onCloseDone(err) {
        if (err) return self.emit("error", err);
        self.emit("close");
      }
    };
    RandomAccessReader.prototype.createReadStream = function(options2) {
      if (options2 == null) options2 = {};
      var start = options2.start;
      var end = options2.end;
      if (start === end) {
        var emptyStream = new PassThrough();
        setImmediate(function() {
          emptyStream.end();
        });
        return emptyStream;
      }
      var stream = this._readStreamForRange(start, end);
      var destroyed = false;
      var refUnrefFilter = new RefUnrefFilter(this);
      stream.on("error", function(err) {
        setImmediate(function() {
          if (!destroyed) refUnrefFilter.emit("error", err);
        });
      });
      installDestroyFn(refUnrefFilter, function() {
        stream.unpipe(refUnrefFilter);
        refUnrefFilter.unref();
        stream.destroy();
      });
      var byteCounter = new AssertByteCountStream(end - start);
      refUnrefFilter.on("error", function(err) {
        setImmediate(function() {
          if (!destroyed) byteCounter.emit("error", err);
        });
      });
      installDestroyFn(byteCounter, function() {
        destroyed = true;
        refUnrefFilter.unpipe(byteCounter);
        refUnrefFilter.destroy();
      });
      return stream.pipe(refUnrefFilter).pipe(byteCounter);
    };
    RandomAccessReader.prototype._readStreamForRange = function(start, end) {
      throw new Error("not implemented");
    };
    RandomAccessReader.prototype.read = function(buffer, offset, length, position, callback) {
      var readStream = this.createReadStream({ start: position, end: position + length });
      var writeStream = new Writable();
      var written = 0;
      writeStream._write = function(chunk, encoding, cb) {
        chunk.copy(buffer, offset + written, 0, chunk.length);
        written += chunk.length;
        cb();
      };
      writeStream.on("finish", callback);
      readStream.on("error", function(error) {
        callback(error);
      });
      readStream.pipe(writeStream);
    };
    RandomAccessReader.prototype.close = function(callback) {
      setImmediate(callback);
    };
    util.inherits(RefUnrefFilter, PassThrough);
    function RefUnrefFilter(context) {
      PassThrough.call(this);
      this.context = context;
      this.context.ref();
      this.unreffedYet = false;
    }
    RefUnrefFilter.prototype._flush = function(cb) {
      this.unref();
      cb();
    };
    RefUnrefFilter.prototype.unref = function(cb) {
      if (this.unreffedYet) return;
      this.unreffedYet = true;
      this.context.unref();
    };
    var cp437 = "\0\u263A\u263B\u2665\u2666\u2663\u2660\u2022\u25D8\u25CB\u25D9\u2642\u2640\u266A\u266B\u263C\u25BA\u25C4\u2195\u203C\xB6\xA7\u25AC\u21A8\u2191\u2193\u2192\u2190\u221F\u2194\u25B2\u25BC !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u2302\xC7\xFC\xE9\xE2\xE4\xE0\xE5\xE7\xEA\xEB\xE8\xEF\xEE\xEC\xC4\xC5\xC9\xE6\xC6\xF4\xF6\xF2\xFB\xF9\xFF\xD6\xDC\xA2\xA3\xA5\u20A7\u0192\xE1\xED\xF3\xFA\xF1\xD1\xAA\xBA\xBF\u2310\xAC\xBD\xBC\xA1\xAB\xBB\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580\u03B1\xDF\u0393\u03C0\u03A3\u03C3\xB5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229\u2261\xB1\u2265\u2264\u2320\u2321\xF7\u2248\xB0\u2219\xB7\u221A\u207F\xB2\u25A0\xA0";
    function decodeBuffer(buffer, isUtf8) {
      if (isUtf8) {
        return buffer.toString("utf8");
      } else {
        var result = "";
        for (var i = 0; i < buffer.length; i++) {
          result += cp437[buffer[i]];
        }
        return result;
      }
    }
    function readUInt64LE(buffer, offset) {
      var lower32 = buffer.readUInt32LE(offset);
      var upper32 = buffer.readUInt32LE(offset + 4);
      return upper32 * 4294967296 + lower32;
    }
    var newBuffer;
    if (typeof Buffer.allocUnsafe === "function") {
      newBuffer = function(len) {
        return Buffer.allocUnsafe(len);
      };
    } else {
      newBuffer = function(len) {
        return new Buffer(len);
      };
    }
    function installDestroyFn(stream, fn) {
      if (typeof stream.destroy === "function") {
        stream._destroy = function(err, cb) {
          fn();
          if (cb != null) cb(err);
        };
      } else {
        stream.destroy = fn;
      }
    }
    function defaultCallback(err) {
      if (err) throw err;
    }
  }
});

// vendor/mineru/source/runtime-paths.js
var require_runtime_paths = __commonJS({
  "vendor/mineru/source/runtime-paths.js"(exports2) {
    "use strict";
    exports2.getPdfWorkerDir = () => __dirname;
  }
});

// vendor/mineru/source/mineru-layout-normalizer.js
var require_mineru_layout_normalizer = __commonJS({
  "vendor/mineru/source/mineru-layout-normalizer.js"(exports2, module2) {
    "use strict";
    var fs2 = require("fs/promises");
    var path2 = require("path");
    var { getPdfWorkerDir } = require_runtime_paths();
    var MAX_LAYOUT_JSON_CHARS = 80 * 1024 * 1024;
    var MAX_LAYOUT_BLOCKS = 2e4;
    var MAX_COMPOSITE_IMAGE_ITEMS = 32;
    var MAX_COMPOSITE_CANVAS_DIMENSION = 12e3;
    var MAX_COMPOSITE_CANVAS_PIXELS = 32 * 1024 * 1024;
    var MAX_BBOX_COORDINATE = 1e6;
    var SAFE_ASSET_SEGMENT_PATTERN = /^[A-Za-z0-9._ -]+$/u;
    function areSamePath2(left, right) {
      const resolvedLeft = path2.resolve(String(left || ""));
      const resolvedRight = path2.resolve(String(right || ""));
      return process.platform === "win32" ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight;
    }
    function isPathInsideOrSameDirectory2(targetPath, parentDir) {
      const target = path2.resolve(String(targetPath || ""));
      const parent = path2.resolve(String(parentDir || ""));
      if (areSamePath2(target, parent)) {
        return true;
      }
      const relative = path2.relative(parent, target);
      return Boolean(relative) && !relative.startsWith("..") && !path2.isAbsolute(relative);
    }
    function normalizeRelativeAssetPath(value) {
      const normalized = String(value || "").trim().replace(/\\/g, "/");
      if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//u.test(normalized) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(normalized)) {
        return "";
      }
      const parts = normalized.split("/").filter(Boolean);
      if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || !SAFE_ASSET_SEGMENT_PATTERN.test(part))) {
        return "";
      }
      return parts.join("/");
    }
    function resolveAssetPathWithinOutputDir(outputDir, relativePath) {
      const safeRelativePath = normalizeRelativeAssetPath(relativePath);
      if (!safeRelativePath || !outputDir) {
        return null;
      }
      const rootDir = path2.resolve(String(outputDir));
      const absolutePath = path2.resolve(rootDir, safeRelativePath);
      if (!isPathInsideOrSameDirectory2(absolutePath, rootDir)) {
        return null;
      }
      return {
        relativePath: safeRelativePath,
        absolutePath
      };
    }
    function flattenMineruBlocks(parsed) {
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).filter(Boolean);
    }
    function getMineruBlockPageIndex(block) {
      const zeroBasedCandidates = [
        block?.page_idx,
        block?.page_index,
        block?.pageIndex,
        block?.content?.page_idx,
        block?.content?.page_index,
        block?.content?.pageIndex
      ];
      for (const value of zeroBasedCandidates) {
        const pageIndex = Number(value);
        if (Number.isInteger(pageIndex) && pageIndex >= 0) {
          return pageIndex;
        }
      }
      const oneBasedCandidates = [
        block?.page_number,
        block?.page_no,
        block?.pageNo,
        block?.page,
        block?.content?.page_number,
        block?.content?.page_no,
        block?.content?.pageNo,
        block?.content?.page
      ];
      for (const value of oneBasedCandidates) {
        const pageNumber = Number(value);
        if (Number.isInteger(pageNumber) && pageNumber > 0) {
          return pageNumber - 1;
        }
      }
      return null;
    }
    function normalizeMineruContentListPages(parsed) {
      if (!Array.isArray(parsed)) {
        return [];
      }
      if (parsed.every((entry) => Array.isArray(entry))) {
        return parsed;
      }
      const blocks = flattenMineruBlocks(parsed);
      let hasExplicitPageIndex = false;
      for (const block of blocks) {
        if (getMineruBlockPageIndex(block) !== null) {
          hasExplicitPageIndex = true;
          break;
        }
      }
      if (!hasExplicitPageIndex) {
        return blocks.length ? [blocks] : [];
      }
      const pages = [];
      let currentPageIndex = 0;
      for (const block of blocks) {
        const explicitPageIndex = getMineruBlockPageIndex(block);
        if (explicitPageIndex !== null) {
          currentPageIndex = explicitPageIndex;
        }
        if (!pages[currentPageIndex]) {
          pages[currentPageIndex] = [];
        }
        pages[currentPageIndex].push(block);
      }
      return pages.map((pageItems) => pageItems || []);
    }
    function extractRichText(node) {
      if (!node) {
        return "";
      }
      if (typeof node === "string") {
        return node.trim();
      }
      if (Array.isArray(node)) {
        return node.map((item) => extractRichText(item)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      }
      if (typeof node.text === "string") {
        return node.text.trim();
      }
      if (typeof node.text_content === "string") {
        return node.text_content.trim();
      }
      if (typeof node.content === "string") {
        return node.content.trim();
      }
      const nestedKeys = [
        "item_content",
        "paragraph_content",
        "title_content",
        "image_caption",
        "image_footnote",
        "chart_caption",
        "chart_footnote",
        "table_caption",
        "table_footnote",
        "page_header_content",
        "page_footer_content",
        "page_footnote_content",
        "page_aside_text_content"
      ];
      for (const key of nestedKeys) {
        if (Array.isArray(node[key])) {
          return extractRichText(node[key]);
        }
      }
      if (typeof node.math_content === "string") {
        return node.math_content.trim();
      }
      return "";
    }
    function normalizeText(value) {
      return String(value || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim();
    }
    function stripInlineHtml(value) {
      return normalizeText(String(value || "").replace(/<[^>]+>/g, " "));
    }
    function firstRichText(...candidates) {
      for (const candidate of candidates) {
        const text = extractRichText(candidate);
        if (text) {
          return normalizeText(text);
        }
      }
      return "";
    }
    function getTitleText(block) {
      return firstRichText(
        block?.content?.title_content,
        block?.title,
        block?.text,
        block?.content?.text,
        block?.content
      );
    }
    function getParagraphText(block) {
      return firstRichText(
        block?.content?.paragraph_content,
        block?.text,
        block?.text_content,
        block?.content?.text,
        block?.content?.text_content,
        block?.content
      );
    }
    function getListItemText(item) {
      return normalizeText(extractRichText(item?.item_content || item));
    }
    function getCaptionText(block) {
      const blockType = String(block?.type || "").toLowerCase();
      if (blockType === "table") {
        return normalizeText([
          extractRichText(block?.table_caption),
          extractRichText(block?.content?.table_caption),
          extractRichText(block?.table_footnote),
          extractRichText(block?.content?.table_footnote)
        ].filter(Boolean).join(" "));
      }
      return normalizeText([
        extractRichText(block?.chart_caption),
        extractRichText(block?.content?.chart_caption),
        extractRichText(block?.image_caption),
        extractRichText(block?.content?.image_caption),
        extractRichText(block?.chart_footnote),
        extractRichText(block?.content?.chart_footnote),
        extractRichText(block?.image_footnote),
        extractRichText(block?.content?.image_footnote)
      ].filter(Boolean).join(" "));
    }
    function getEquationText(block) {
      return firstRichText(
        block?.content?.math_content,
        block?.math_content,
        block?.latex,
        block?.tex,
        block?.text,
        block?.content
      );
    }
    function getMediaImagePath(block) {
      const imagePath = block?.img_path || block?.image_path || block?.content?.image_source?.path || block?.content?.img_path || block?.content?.image_path;
      return normalizeRelativeAssetPath(imagePath);
    }
    function getBlockBBox(block) {
      const bbox = Array.isArray(block?.bbox) ? block.bbox.map((value) => Number(value)) : [];
      if (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) {
        return null;
      }
      const [x1, y1, x2, y2] = bbox;
      if (bbox.some((value) => Math.abs(value) > MAX_BBOX_COORDINATE)) {
        return null;
      }
      if (x2 <= x1 || y2 <= y1) {
        return null;
      }
      return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
    }
    function getHeadingLevel(block) {
      const rawLevel = Number(block?.content?.level);
      if (Number.isFinite(rawLevel) && rawLevel > 0) {
        return Math.min(6, Math.max(1, Math.floor(rawLevel)));
      }
      return 1;
    }
    function isFullFigureCaption(text) {
      return /(?:^|\s)(?:fig(?:ure)?\.?)\s*[A-Za-z]*\d[A-Za-z0-9.-]*[.:：\s]/i.test(stripInlineHtml(text));
    }
    function isFullTableCaption(text) {
      return /(?:^|\s)table\s*[A-Za-z]*\d[A-Za-z0-9.-]*[.:：\s]/i.test(stripInlineHtml(text));
    }
    function isSubfigureCaption(text) {
      return /^\(?[a-z]\)?\.?/i.test(stripInlineHtml(text));
    }
    function getCaptionLabel(text, fallbackKind, fallbackIndex) {
      const normalized = stripInlineHtml(text);
      const tableMatch = normalized.match(/(?:^|\s)table\s*([A-Za-z]*\d[A-Za-z0-9.-]*)/i);
      if (tableMatch) {
        return `table-${tableMatch[1].replace(/[.:：]+$/u, "")}`;
      }
      const figureMatch = normalized.match(/(?:^|\s)fig(?:ure)?\.?\s*([A-Za-z]*\d[A-Za-z0-9.-]*)/i);
      if (figureMatch) {
        return `figure-${figureMatch[1].replace(/[.:：]+$/u, "")}`;
      }
      return `${fallbackKind}-${fallbackIndex}`;
    }
    function splitTrailingSubcaption(caption) {
      const normalized = normalizeText(caption);
      const match = normalized.match(/^(.*\S)\s+(\([a-z]\)\s+[^()]+)$/i);
      if (!match) {
        return null;
      }
      const head = normalizeText(match[1]);
      const tail = normalizeText(match[2]);
      if (tail.length > 64) {
        return null;
      }
      if (!head || !tail || !isFullFigureCaption(head) && !isFullTableCaption(head)) {
        return null;
      }
      return { head, tail };
    }
    function getBBoxArray(bbox) {
      if (Array.isArray(bbox)) {
        return bbox;
      }
      if (bbox && typeof bbox === "object") {
        return [bbox.x1, bbox.y1, bbox.x2, bbox.y2];
      }
      return null;
    }
    function getBBoxArea(bbox) {
      const values = getBBoxArray(bbox);
      if (!values) {
        return 0;
      }
      const width = Math.max(0, Number(values[2]) - Number(values[0]));
      const height = Math.max(0, Number(values[3]) - Number(values[1]));
      return width * height;
    }
    function getIntersectionArea(a, b) {
      const boxA = getBBoxArray(a);
      const boxB = getBBoxArray(b);
      if (!boxA || !boxB) {
        return 0;
      }
      const x1 = Math.max(Number(boxA[0]), Number(boxB[0]));
      const y1 = Math.max(Number(boxA[1]), Number(boxB[1]));
      const x2 = Math.min(Number(boxA[2]), Number(boxB[2]));
      const y2 = Math.min(Number(boxA[3]), Number(boxB[3]));
      return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    }
    function hasDescriptiveCaption(media) {
      const caption = stripInlineHtml(media?.caption);
      return media?.hasFullCaption || caption.length >= 80;
    }
    function shouldMergePendingFragmentsWithMedia(fragments, media) {
      if (media?.kind !== "image" || !media?.bbox || !hasDescriptiveCaption(media)) {
        return false;
      }
      const compatibleFragments = fragments.filter((item) => item.kind === media.kind);
      if (!compatibleFragments.length) {
        return false;
      }
      return compatibleFragments.every((item) => {
        if (!item.bbox || item.hasFullCaption) {
          return false;
        }
        const area = getBBoxArea(item.bbox);
        return area > 0 && getIntersectionArea(item.bbox, media.bbox) / area >= 0.9;
      });
    }
    function getMediaInfo(block, blockIndex) {
      const blockType = String(block?.type || "").toLowerCase();
      const caption = getCaptionText(block);
      const trailingCaptionSplit = splitTrailingSubcaption(caption);
      let kind = blockType === "table" ? "table" : "image";
      if (isFullTableCaption(caption)) {
        kind = "table";
      } else if (isFullFigureCaption(caption)) {
        kind = "image";
      }
      const hasFullCaption = kind === "image" ? isFullFigureCaption(caption) : isFullTableCaption(caption);
      return {
        type: "media",
        kind,
        block,
        blockIndex,
        caption,
        trailingCaptionSplit,
        hasFullCaption,
        isFragment: !caption || isSubfigureCaption(caption),
        imagePath: getMediaImagePath(block),
        bbox: getBlockBBox(block),
        html: typeof block?.content?.html === "string" ? block.content.html : "",
        originalBlockType: blockType
      };
    }
    function isMediaBlock(block) {
      const type = String(block?.type || "").toLowerCase();
      return type === "image" || type === "table" || type === "chart";
    }
    function groupMineruBlocks(blocks) {
      const output = [];
      let pendingMedia = [];
      let mediaOrdinal = 0;
      function flushPending() {
        for (const item of pendingMedia) {
          mediaOrdinal += 1;
          output.push({
            type: "mediaGroup",
            kind: item.kind,
            caption: item.caption,
            label: getCaptionLabel(item.caption, item.kind, mediaOrdinal),
            items: [item]
          });
        }
        pendingMedia = [];
      }
      for (const [blockIndex, block] of blocks.entries()) {
        if (!isMediaBlock(block)) {
          flushPending();
          output.push({ type: "block", block, blockIndex });
          continue;
        }
        const media = getMediaInfo(block, blockIndex);
        if (media.hasFullCaption && media.trailingCaptionSplit && pendingMedia.length) {
          const compatibleFragments2 = pendingMedia.filter((item) => item.kind === media.kind);
          const incompatibleFragments2 = pendingMedia.filter((item) => !compatibleFragments2.includes(item));
          pendingMedia = incompatibleFragments2;
          flushPending();
          if (compatibleFragments2.length) {
            mediaOrdinal += 1;
            output.push({
              type: "mediaGroup",
              kind: media.kind,
              caption: media.trailingCaptionSplit.head,
              label: getCaptionLabel(media.trailingCaptionSplit.head, media.kind, mediaOrdinal),
              items: compatibleFragments2
            });
          }
          pendingMedia.push({
            ...media,
            caption: media.trailingCaptionSplit.tail,
            hasFullCaption: false,
            isFragment: true
          });
          continue;
        }
        if (!media.hasFullCaption) {
          if (shouldMergePendingFragmentsWithMedia(pendingMedia, media)) {
            const compatibleFragments2 = pendingMedia.filter((item) => item.kind === media.kind);
            const incompatibleFragments2 = pendingMedia.filter((item) => !compatibleFragments2.includes(item));
            pendingMedia = incompatibleFragments2;
            flushPending();
            mediaOrdinal += 1;
            output.push({
              type: "mediaGroup",
              kind: media.kind,
              caption: media.caption,
              label: getCaptionLabel(media.caption, media.kind, mediaOrdinal),
              items: [...compatibleFragments2, media]
            });
            continue;
          }
          pendingMedia.push(media);
          continue;
        }
        const compatibleFragments = pendingMedia.filter((item) => item.kind === media.kind);
        const incompatibleFragments = pendingMedia.filter((item) => !compatibleFragments.includes(item));
        pendingMedia = incompatibleFragments;
        flushPending();
        mediaOrdinal += 1;
        output.push({
          type: "mediaGroup",
          kind: media.kind,
          caption: media.caption,
          label: getCaptionLabel(media.caption, media.kind, mediaOrdinal),
          items: [...compatibleFragments, media]
        });
      }
      flushPending();
      return output;
    }
    function getUniqueCompositeName(usedNames, label) {
      const safeLabel = String(label || "composite").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "composite";
      let name = `${safeLabel}.jpg`;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${safeLabel}-${suffix}.jpg`;
        suffix += 1;
      }
      usedNames.add(name);
      return name;
    }
    function resolveCanvasModule() {
      const candidates = [
        path2.join(getPdfWorkerDir(), "pdf.js", "node_modules", "@napi-rs", "canvas"),
        path2.join(__dirname, "node_modules", "@napi-rs", "canvas")
      ];
      for (const candidate of candidates) {
        try {
          return require(candidate);
        } catch {
        }
      }
      throw new Error("Cannot find @napi-rs/canvas for MinerU composite rendering");
    }
    function getUnionBBox(items) {
      const bboxes = items.map((item) => item.bbox).filter(Boolean);
      if (!bboxes.length) {
        return null;
      }
      const x1 = Math.min(...bboxes.map((bbox) => bbox.x1));
      const y1 = Math.min(...bboxes.map((bbox) => bbox.y1));
      const x2 = Math.max(...bboxes.map((bbox) => bbox.x2));
      const y2 = Math.max(...bboxes.map((bbox) => bbox.y2));
      return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
    }
    function buildMineruLayoutMediaGroups(parsed) {
      if (!Array.isArray(parsed)) {
        return [];
      }
      const pages = normalizeMineruContentListPages(parsed);
      const mediaGroups = [];
      for (const [pageIndex, pageItems] of pages.entries()) {
        const groupedBlocks = groupMineruBlocks(Array.isArray(pageItems) ? pageItems : []);
        for (const entry of groupedBlocks) {
          if (entry.type !== "mediaGroup") {
            continue;
          }
          const unionBBox = getUnionBBox(entry.items);
          if (!unionBBox) {
            continue;
          }
          mediaGroups.push({
            kind: entry.kind,
            layoutKind: entry.kind === "table" ? "table" : "figure",
            pageIndex,
            caption: entry.caption,
            label: entry.label,
            bbox: [unionBBox.x1, unionBBox.y1, unionBBox.x2, unionBBox.y2],
            unionBBox,
            blockIndices: entry.items.map((item) => item.blockIndex),
            imagePaths: entry.items.map((item) => item.imagePath).filter(Boolean),
            childBBoxes: entry.items.map((item) => item.bbox).filter(Boolean),
            itemCount: entry.items.length,
            isComposite: entry.kind === "image" && entry.items.length > 1
          });
        }
      }
      return mediaGroups;
    }
    async function createCompositeImage({ group, outputDir, usedNames }) {
      const imageItems = group.items.filter((item) => item.imagePath);
      if (group.kind !== "image" || imageItems.length <= 1) {
        return imageItems[0]?.imagePath || "";
      }
      if (imageItems.length > MAX_COMPOSITE_IMAGE_ITEMS) {
        return imageItems[0]?.imagePath || "";
      }
      const resolvedOutputDir = outputDir ? path2.resolve(String(outputDir)) : "";
      if (!resolvedOutputDir) {
        return imageItems[0]?.imagePath || "";
      }
      const union = getUnionBBox(imageItems);
      if (!union) {
        return imageItems[0]?.imagePath || "";
      }
      const { createCanvas, loadImage } = resolveCanvasModule();
      const scale = 2;
      const padding = 8;
      const canvasWidth = Math.max(1, Math.ceil(union.width * scale) + padding * 2);
      const canvasHeight = Math.max(1, Math.ceil(union.height * scale) + padding * 2);
      if (canvasWidth > MAX_COMPOSITE_CANVAS_DIMENSION || canvasHeight > MAX_COMPOSITE_CANVAS_DIMENSION || canvasWidth * canvasHeight > MAX_COMPOSITE_CANVAS_PIXELS) {
        return imageItems[0]?.imagePath || "";
      }
      const canvas = createCanvas(canvasWidth, canvasHeight);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      for (const item of imageItems) {
        const resolvedImage = resolveAssetPathWithinOutputDir(resolvedOutputDir, item.imagePath);
        if (!resolvedImage) {
          return imageItems[0]?.imagePath || "";
        }
        const imageFullPath = resolvedImage.absolutePath;
        const image = await loadImage(imageFullPath);
        const x = Math.round((item.bbox.x1 - union.x1) * scale) + padding;
        const y = Math.round((item.bbox.y1 - union.y1) * scale) + padding;
        const width = Math.max(1, Math.round(item.bbox.width * scale));
        const height = Math.max(1, Math.round(item.bbox.height * scale));
        context.drawImage(image, x, y, width, height);
      }
      const compositeDir = path2.resolve(resolvedOutputDir, "images", "_composite");
      if (!isPathInsideOrSameDirectory2(compositeDir, resolvedOutputDir)) {
        return imageItems[0]?.imagePath || "";
      }
      await fs2.mkdir(compositeDir, { recursive: true });
      const compositeName = getUniqueCompositeName(usedNames, group.label);
      const compositeRelativePath = path2.posix.join("images", "_composite", compositeName);
      const compositePath = path2.resolve(resolvedOutputDir, compositeRelativePath);
      if (!isPathInsideOrSameDirectory2(compositePath, compositeDir)) {
        return imageItems[0]?.imagePath || "";
      }
      await fs2.writeFile(compositePath, canvas.toBuffer("image/jpeg", 92));
      return compositeRelativePath;
    }
    function renderTitleBlock(block) {
      const title = getTitleText(block);
      if (!title) {
        return "";
      }
      return `${"#".repeat(getHeadingLevel(block))} ${title}`;
    }
    function renderParagraphBlock(block) {
      return getParagraphText(block);
    }
    function renderListBlock(block) {
      const listItems = Array.isArray(block?.content?.list_items) ? block.content.list_items : [];
      return listItems.map((item) => getListItemText(item)).filter(Boolean).map((text) => String(block?.content?.list_type || "").toLowerCase() === "reference_list" ? text : `- ${text}`).join("\n");
    }
    function renderEquationBlock(block) {
      const text = getEquationText(block);
      return text ? `$$
${text}
$$` : "";
    }
    function renderCodeBlock(block) {
      const text = getParagraphText(block);
      return text ? `\`\`\`
${text}
\`\`\`` : "";
    }
    async function renderMediaGroup(group, outputDir, usedCompositeNames) {
      const mediaPath = await createCompositeImage({ group, outputDir, usedNames: usedCompositeNames });
      const caption = normalizeText(group.caption);
      if (group.kind === "table") {
        const tableItem = group.items[group.items.length - 1];
        const parts2 = [];
        if (caption) {
          parts2.push(caption);
        }
        if (tableItem?.html) {
          parts2.push(tableItem.html);
        } else if (mediaPath) {
          parts2.push(`![](${mediaPath})`);
        }
        return parts2.join("\n\n");
      }
      const parts = [];
      if (mediaPath) {
        parts.push(`![](${mediaPath})`);
      }
      if (caption) {
        parts.push(caption);
      }
      return parts.join("  \n");
    }
    async function normalizeMineruMarkdownLayout2({ markdown = "", jsonText = "", outputDir = "" } = {}) {
      if (String(jsonText || "").length > MAX_LAYOUT_JSON_CHARS) {
        throw new Error(`MinerU layout JSON \u8FC7\u5927 (${MAX_LAYOUT_JSON_CHARS} chars)`);
      }
      const parsed = JSON.parse(jsonText);
      const blocks = flattenMineruBlocks(parsed);
      if (blocks.length > MAX_LAYOUT_BLOCKS) {
        throw new Error(`MinerU layout block \u6570\u91CF\u8D85\u8FC7\u4E0A\u9650 (${MAX_LAYOUT_BLOCKS})`);
      }
      const groupedBlocks = groupMineruBlocks(blocks);
      const usedCompositeNames = /* @__PURE__ */ new Set();
      const rendered = [];
      for (const entry of groupedBlocks) {
        let chunk = "";
        if (entry.type === "mediaGroup") {
          chunk = await renderMediaGroup(entry, outputDir, usedCompositeNames);
        } else {
          const block = entry.block;
          const blockType = String(block?.type || "").toLowerCase();
          if (blockType === "title") {
            chunk = renderTitleBlock(block);
          } else if (["paragraph", "text", "ref_text", "aside_text", "page_footnote"].includes(blockType)) {
            chunk = renderParagraphBlock(block);
          } else if (blockType === "list") {
            chunk = renderListBlock(block);
          } else if (blockType === "equation_interline" || blockType === "equation") {
            chunk = renderEquationBlock(block);
          } else if (blockType === "code") {
            chunk = renderCodeBlock(block);
          }
        }
        if (chunk) {
          rendered.push(chunk);
        }
      }
      const normalizedMarkdown = rendered.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      return {
        markdown: normalizedMarkdown || markdown,
        groups: groupedBlocks.filter((entry) => entry.type === "mediaGroup").map((entry) => ({
          kind: entry.kind,
          caption: entry.caption,
          label: entry.label,
          blockIndices: entry.items.map((item) => item.blockIndex),
          imagePaths: entry.items.map((item) => item.imagePath).filter(Boolean),
          bboxes: entry.items.map((item) => item.bbox).filter(Boolean),
          unionBBox: getUnionBBox(entry.items),
          isComposite: entry.kind === "image" && entry.items.length > 1
        }))
      };
    }
    module2.exports = {
      buildMineruLayoutMediaGroups,
      normalizeMineruContentListPages,
      normalizeMineruMarkdownLayout: normalizeMineruMarkdownLayout2
    };
  }
});

// vendor/mineru/source/mineru-markdown-service.js
var path = require("path");
var fs = require("fs/promises");
var yauzl = require_yauzl();
var { normalizeMineruMarkdownLayout } = require_mineru_layout_normalizer();
var MAX_ZIP_BYTES = 500 * 1024 * 1024;
var MAX_TEXT_ENTRY_BYTES = 80 * 1024 * 1024;
var MAX_IMAGE_ENTRY_BYTES = 50 * 1024 * 1024;
var MAX_TOTAL_IMAGE_BYTES = 300 * 1024 * 1024;
var MAX_IMAGE_ENTRY_COUNT = 2e3;
var MAX_PDF_UPLOAD_BYTES = 150 * 1024 * 1024;
var MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
var MAX_BATCH_ITEMS = 50;
var MAX_UPLOAD_CONCURRENCY = 3;
var MAX_ZIP_IMAGE_IO_CONCURRENCY = 8;
var FETCH_JSON_TIMEOUT_MS = 30 * 1e3;
var FETCH_UPLOAD_BASE_TIMEOUT_MS = 2 * 60 * 1e3;
var FETCH_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1e3;
var MIN_SOURCE_MARKDOWN_TEXT_CHARACTERS = 160;
var MIN_SOURCE_MARKDOWN_COVERAGE_RATIO = 0.35;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function resolvePdfFilePath(value, missingMessage) {
  const rawPath = typeof value === "string" ? value.trim() : "";
  if (!rawPath) {
    throw new Error(missingMessage);
  }
  if (hasUnsafePathText(rawPath)) {
    throw new Error(`\u975E\u6CD5 PDF \u8DEF\u5F84: ${rawPath}`);
  }
  const filePath = path.resolve(rawPath);
  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new Error(`PDF \u6587\u4EF6\u4E0D\u5B58\u5728: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`PDF \u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6: ${filePath}`);
  }
  if (path.extname(filePath).toLowerCase() !== ".pdf") {
    throw new Error(`\u4EC5\u652F\u6301 PDF \u6587\u4EF6: ${filePath}`);
  }
  if (stat.size > MAX_PDF_UPLOAD_BYTES) {
    throw new Error(`PDF \u6587\u4EF6\u8FC7\u5927\uFF0CMinerU \u6700\u5927\u652F\u6301 ${Math.round(MAX_PDF_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }
  return filePath;
}
function hasUnsafePathText(value) {
  const rawPath = String(value || "").trim();
  return /[\u0000-\u001f\u007f]/u.test(rawPath) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(rawPath) && !/^[a-zA-Z]:[\\/]/u.test(rawPath);
}
function parseHttpUrl(value, label) {
  let url = null;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(`${label} URL \u65E0\u6548`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} URL \u534F\u8BAE\u4E0D\u53D7\u652F\u6301: ${url.protocol || "unknown"}`);
  }
  return url;
}
function normalizeBaseURL(value) {
  const baseURL = String(value || "").trim();
  if (!baseURL) {
    throw new Error("\u7F3A\u5C11 MinerU \u4E91\u7AEF\u670D\u52A1 URL\uFF0C\u8BF7\u914D\u7F6E MINERU_UPLOAD_SERVICE_BASE_URL");
  }
  return parseHttpUrl(baseURL, "MinerU cloud service").toString().replace(/\/+$/, "");
}
function getMarkdownTextCharacterCount(markdown) {
  const plainText = String(markdown || "").replace(/```[\s\S]*?```/gu, " ").replace(/!\[[^\]]*\]\([^)]*\)/gu, " ").replace(/\[[^\]]*\]\([^)]*\)/gu, " ").replace(/<[^>]*>/gu, " ").replace(/[`*_~>#|\[\](){}]/gu, " ").replace(/\s+/gu, "");
  return [...plainText].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}
function selectPreferredMarkdownOutput({ sourceMarkdown = "", normalizedMarkdown = "" } = {}) {
  const source = String(sourceMarkdown || "").trim();
  const normalized = String(normalizedMarkdown || "").trim();
  if (!source) {
    return normalized;
  }
  if (!normalized) {
    return source;
  }
  const sourceTextCharacters = getMarkdownTextCharacterCount(source);
  const normalizedTextCharacters = getMarkdownTextCharacterCount(normalized);
  if (sourceTextCharacters >= MIN_SOURCE_MARKDOWN_TEXT_CHARACTERS && sourceTextCharacters >= normalizedTextCharacters * MIN_SOURCE_MARKDOWN_COVERAGE_RATIO) {
    return source;
  }
  return normalizedTextCharacters > sourceTextCharacters ? normalized : source;
}
function sanitizeUrlForLog(value) {
  try {
    const url = new URL(String(value || ""));
    url.search = url.search ? "?\u2026" : "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
function areSamePath(left, right) {
  const resolvedLeft = path.resolve(String(left || ""));
  const resolvedRight = path.resolve(String(right || ""));
  return process.platform === "win32" ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight;
}
function isPathInsideOrSameDirectory(targetPath, parentDir) {
  const target = path.resolve(String(targetPath || ""));
  const parent = path.resolve(String(parentDir || ""));
  if (areSamePath(target, parent)) {
    return true;
  }
  const relative = path.relative(parent, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function resolveOutputMarkdownPath(outputPath, sourcePath) {
  const rawOutputPath = outputPath ? String(outputPath).trim() : "";
  if (rawOutputPath && hasUnsafePathText(rawOutputPath)) {
    throw new Error(`\u975E\u6CD5 Markdown \u8F93\u51FA\u8DEF\u5F84: ${rawOutputPath}`);
  }
  const targetPath = rawOutputPath ? path.resolve(rawOutputPath) : path.join(path.dirname(sourcePath), `${path.parse(sourcePath).name}-mineru.md`);
  if (hasUnsafePathText(targetPath)) {
    throw new Error(`\u975E\u6CD5 Markdown \u8F93\u51FA\u8DEF\u5F84: ${targetPath}`);
  }
  if (path.extname(targetPath).toLowerCase() !== ".md") {
    throw new Error(`Markdown \u8F93\u51FA\u8DEF\u5F84\u5FC5\u987B\u4F7F\u7528 .md \u6269\u5C55\u540D: ${targetPath}`);
  }
  if (areSamePath(path.dirname(targetPath), path.parse(targetPath).root)) {
    throw new Error(`\u62D2\u7EDD\u628A MinerU \u8F93\u51FA\u5199\u5230\u78C1\u76D8\u6839\u76EE\u5F55: ${targetPath}`);
  }
  return targetPath;
}
function getContentLength(response) {
  const rawLength = response.headers?.get?.("content-length");
  if (!rawLength) {
    return null;
  }
  const length = Number(rawLength);
  return Number.isFinite(length) && length >= 0 ? length : null;
}
async function readResponseBodyWithLimit(response, maxBytes, label) {
  const contentLength = getContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error(`${label} \u4F53\u79EF\u8D85\u8FC7\u4E0A\u9650 (${maxBytes} bytes)`);
  }
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          throw new Error(`${label} \u4F53\u79EF\u8D85\u8FC7\u4E0A\u9650 (${maxBytes} bytes)`);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, totalBytes);
    } finally {
      reader.releaseLock?.();
    }
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`${label} \u4F53\u79EF\u8D85\u8FC7\u4E0A\u9650 (${maxBytes} bytes)`);
  }
  return buffer;
}
async function fetchWithTimeout(url, options2 = {}, timeoutMs = FETCH_JSON_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1e3, Number(timeoutMs) || FETCH_JSON_TIMEOUT_MS));
  try {
    return await fetch(url, {
      ...options2,
      signal: options2.signal || controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}
async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}
function getErrorMessage(payload, fallback) {
  if (!payload) {
    return fallback;
  }
  return payload.message || payload.error || payload.errMsg || payload.msg || fallback;
}
async function parseJSONResponse(response, fallbackMessage) {
  let data = null;
  try {
    const raw = await readResponseBodyWithLimit(response, MAX_JSON_RESPONSE_BYTES, "MinerU JSON response");
    data = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`${fallbackMessage}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(getErrorMessage(data, `${fallbackMessage} (${response.status})`));
  }
  return data;
}
function openZipFromBuffer(buffer) {
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new Error(`MinerU \u8FD4\u56DE\u7684 zip \u4F53\u79EF\u8D85\u8FC7\u4E0A\u9650 (${MAX_ZIP_BYTES} bytes)`);
  }
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(zipfile);
    });
  });
}
function openZipEntryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stream);
    });
  });
}
async function readZipEntryBuffer(zipfile, entry, maxBytes) {
  if (Number(entry?.uncompressedSize || 0) > maxBytes) {
    throw new Error(`MinerU zip entry \u8FC7\u5927: ${entry.fileName}`);
  }
  const stream = await openZipEntryStream(zipfile, entry);
  const chunks = [];
  let totalBytes = 0;
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk || ""));
      if (totalBytes > maxBytes) {
        stream.destroy(new Error(`MinerU zip entry \u8FC7\u5927: ${entry.fileName}`));
        return;
      }
      chunks.push(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}
async function readZipEntryText(zipfile, entry) {
  return (await readZipEntryBuffer(zipfile, entry, MAX_TEXT_ENTRY_BYTES)).toString("utf8");
}
function scoreMarkdownEntry(entryName) {
  const lowerName = String(entryName || "").replace(/\\/g, "/").toLowerCase();
  if (lowerName.endsWith("/full.md") || lowerName === "full.md") {
    return 4;
  }
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return 2;
  }
  return 0;
}
function scoreJsonEntry(entryName) {
  const lowerName = String(entryName || "").replace(/\\/g, "/").toLowerCase();
  if (lowerName.endsWith("/content_list_v2.json") || lowerName === "content_list_v2.json") {
    return 7;
  }
  if (lowerName.endsWith("_content_list.json") || lowerName.endsWith("/content_list.json") || lowerName === "content_list.json") {
    return 6;
  }
  if (lowerName.endsWith("/layout.json") || lowerName === "layout.json") {
    return 4;
  }
  if (lowerName.endsWith("_model.json")) {
    return 3;
  }
  if (lowerName.endsWith(".json")) {
    return 1;
  }
  return 0;
}
function pickPreferredEntry(currentEntry, nextEntry, scoreFn) {
  if (!nextEntry) {
    return currentEntry;
  }
  if (!currentEntry) {
    return nextEntry;
  }
  return scoreFn(nextEntry.fileName) > scoreFn(currentEntry.fileName) ? nextEntry : currentEntry;
}
function normalizeZipEntryPath(entryName, expectedRoot = "") {
  const normalized = String(entryName || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//u.test(normalized)) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return "";
  }
  const relativePath = parts.join("/");
  if (expectedRoot && relativePath !== expectedRoot && !relativePath.startsWith(`${expectedRoot}/`)) {
    return "";
  }
  return relativePath;
}
async function extractResultFilesFromZip(zipBuffer) {
  const zipfile = await openZipFromBuffer(zipBuffer);
  return new Promise((resolve, reject) => {
    let selectedMarkdownEntry = null;
    let selectedJsonEntry = null;
    const imageEntries = [];
    let totalImageBytes = 0;
    const finish = async () => {
      if (!selectedMarkdownEntry) {
        zipfile.close();
        reject(new Error("MinerU \u8FD4\u56DE\u7684 zip \u4E2D\u6CA1\u6709\u627E\u5230 Markdown \u6587\u4EF6"));
        return;
      }
      if (!selectedJsonEntry) {
        zipfile.close();
        reject(new Error("MinerU \u8FD4\u56DE\u7684 zip \u4E2D\u6CA1\u6709\u627E\u5230 JSON \u6587\u4EF6"));
        return;
      }
      try {
        const [markdown, jsonText, images] = await Promise.all([
          readZipEntryText(zipfile, selectedMarkdownEntry),
          readZipEntryText(zipfile, selectedJsonEntry),
          runWithConcurrency(imageEntries, MAX_ZIP_IMAGE_IO_CONCURRENCY, async (entry) => ({
            relativePath: normalizeZipEntryPath(entry.fileName, "images"),
            buffer: await readZipEntryBuffer(zipfile, entry, MAX_IMAGE_ENTRY_BYTES)
          }))
        ]);
        zipfile.close();
        resolve({
          markdownEntryName: selectedMarkdownEntry.fileName,
          jsonEntryName: selectedJsonEntry.fileName,
          markdown,
          jsonText,
          images
        });
      } catch (error) {
        zipfile.close();
        reject(error);
      }
    };
    zipfile.on("entry", (entry) => {
      if (/\/$/.test(entry.fileName)) {
        zipfile.readEntry();
        return;
      }
      const normalizedName = normalizeZipEntryPath(entry.fileName);
      if (!normalizedName) {
        zipfile.readEntry();
        return;
      }
      const lowerName = normalizedName.toLowerCase();
      const isMarkdown = lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
      const isJson = lowerName.endsWith(".json");
      const isImage = lowerName.startsWith("images/");
      if (isMarkdown) {
        selectedMarkdownEntry = pickPreferredEntry(selectedMarkdownEntry, entry, scoreMarkdownEntry);
      }
      if (isJson) {
        selectedJsonEntry = pickPreferredEntry(selectedJsonEntry, entry, scoreJsonEntry);
      }
      if (isImage) {
        const entrySize = Number(entry.uncompressedSize || entry.compressedSize || 0);
        if (imageEntries.length >= MAX_IMAGE_ENTRY_COUNT) {
          zipfile.close();
          reject(new Error(`MinerU \u8FD4\u56DE\u7684 zip \u56FE\u7247\u6570\u91CF\u8D85\u8FC7\u4E0A\u9650 (${MAX_IMAGE_ENTRY_COUNT})`));
          return;
        }
        if (entrySize > MAX_IMAGE_ENTRY_BYTES || totalImageBytes + entrySize > MAX_TOTAL_IMAGE_BYTES) {
          zipfile.close();
          reject(new Error("MinerU \u8FD4\u56DE\u7684 zip \u56FE\u7247\u4F53\u79EF\u8D85\u8FC7\u4E0A\u9650"));
          return;
        }
        totalImageBytes += entrySize;
        imageEntries.push(entry);
      }
      zipfile.readEntry();
    });
    zipfile.once("end", () => {
      finish().catch(reject);
    });
    zipfile.once("error", reject);
    zipfile.readEntry();
  });
}
var MineruMarkdownService = class {
  constructor({
    baseURL = "",
    clientKey = "",
    pollIntervalMs = 5e3,
    timeoutMs = 10 * 60 * 1e3,
    logger = console
  } = {}) {
    this.baseURL = normalizeBaseURL(baseURL);
    this.clientKey = String(clientKey || "").trim();
    this.pollIntervalMs = Math.max(1e3, Number(pollIntervalMs) || 5e3);
    this.timeoutMs = Math.max(1e4, Number(timeoutMs) || 10 * 60 * 1e3);
    this.logger = logger || console;
    this.activeOutputPaths = /* @__PURE__ */ new Set();
  }
  updateConnectionConfig({ baseURL, clientKey } = {}) {
    if (baseURL !== void 0) {
      this.baseURL = normalizeBaseURL(baseURL);
    }
    if (clientKey !== void 0) {
      this.clientKey = String(clientKey || "").trim();
    }
  }
  async convertPdfToMarkdown({
    filePath,
    outputPath,
    language = "en",
    enableFormula = true,
    enableTable = true,
    isOcr = false,
    modelVersion = "vlm",
    dataId = ""
  } = {}) {
    const sourcePath = await resolvePdfFilePath(filePath, "\u7F3A\u5C11\u5F85\u8F6C\u6362\u7684 PDF \u8DEF\u5F84");
    if (!this.clientKey) {
      throw new Error("\u7F3A\u5C11 PDF AI Client Key\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u3002");
    }
    const targetPath = resolveOutputMarkdownPath(outputPath, sourcePath);
    if (this.activeOutputPaths.has(targetPath)) {
      throw new Error("\u5F53\u524D PDF \u7684 Markdown \u8F6C\u6362\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u540E\u518D\u8BD5\u3002");
    }
    this.activeOutputPaths.add(targetPath);
    try {
      return await this._convertPdfToMarkdown({
        sourcePath,
        targetPath,
        language,
        enableFormula,
        enableTable,
        isOcr,
        modelVersion,
        dataId
      });
    } finally {
      this.activeOutputPaths.delete(targetPath);
    }
  }
  async convertPdfBatchToMarkdown({
    items = [],
    language = "en",
    enableFormula = true,
    enableTable = true,
    isOcr = false,
    modelVersion = "vlm"
  } = {}) {
    if (!this.clientKey) {
      throw new Error("\u7F3A\u5C11 PDF AI Client Key\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u3002");
    }
    if (Array.isArray(items) && items.length > MAX_BATCH_ITEMS) {
      throw new Error(`MinerU \u6279\u91CF\u8F6C\u6362\u6570\u91CF\u8D85\u8FC7\u4E0A\u9650 (${MAX_BATCH_ITEMS})`);
    }
    const preparedItems = [];
    for (const item of Array.isArray(items) ? items : []) {
      const sourcePath = await resolvePdfFilePath(item?.filePath, "\u7F3A\u5C11\u5F85\u8F6C\u6362\u7684 PDF \u8DEF\u5F84");
      const targetPath = resolveOutputMarkdownPath(item?.outputPath, sourcePath);
      preparedItems.push({
        ...item,
        sourcePath,
        targetPath,
        dataId: String(item?.dataId || `mineru-${Date.now()}-${preparedItems.length}`).trim()
      });
    }
    if (preparedItems.length === 0) {
      return {
        batchId: "",
        requestedCount: 0,
        results: [],
        failed: []
      };
    }
    for (const item of preparedItems) {
      if (this.activeOutputPaths.has(item.targetPath)) {
        throw new Error(`\u5F53\u524D PDF \u7684 Markdown \u8F6C\u6362\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u540E\u518D\u8BD5: ${item.sourcePath}`);
      }
    }
    preparedItems.forEach((item) => this.activeOutputPaths.add(item.targetPath));
    try {
      return await this._convertPdfBatchToMarkdown({
        items: preparedItems,
        language,
        enableFormula,
        enableTable,
        isOcr,
        modelVersion
      });
    } finally {
      preparedItems.forEach((item) => this.activeOutputPaths.delete(item.targetPath));
    }
  }
  async _convertPdfToMarkdown({
    sourcePath,
    targetPath,
    language,
    enableFormula,
    enableTable,
    isOcr,
    modelVersion,
    dataId
  }) {
    const targetBasePath = targetPath.replace(/\.[^.]+$/, "");
    const jsonTargetPath = `${targetBasePath}.json`;
    const imagesDir = path.join(path.dirname(targetPath), "images");
    const fileBuffer = await fs.readFile(sourcePath);
    this.log("convert:start", {
      sourcePath,
      targetPath,
      jsonTargetPath,
      imagesDir,
      baseURL: this.baseURL,
      language,
      enableFormula: !!enableFormula,
      enableTable: !!enableTable,
      isOcr: !!isOcr,
      modelVersion: String(modelVersion || "vlm")
    });
    const task = await this.createUploadTask({
      fileName: path.basename(sourcePath),
      language,
      isOcr,
      enableFormula,
      enableTable,
      modelVersion,
      dataId
    });
    await this.uploadPdfToMineru(task.uploadUrl, fileBuffer);
    const status = await this.waitForTask(task.batchId);
    const zipUrl = String(status?.zipUrl || "").trim();
    if (!zipUrl) {
      throw new Error("MinerU \u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF0C\u4F46\u6CA1\u6709\u8FD4\u56DE zipUrl");
    }
    const written = await this.writeZipResult({
      targetPath,
      zipUrl
    });
    this.log("convert:done", {
      batchId: task.batchId,
      targetPath,
      jsonTargetPath,
      imagesDir,
      zipUrl: sanitizeUrlForLog(zipUrl),
      markdownEntryName: written.markdownEntryName,
      jsonEntryName: written.jsonEntryName,
      markdownLength: written.markdownLength,
      jsonLength: written.jsonLength,
      imageCount: written.imageCount
    });
    return {
      filePath: targetPath,
      markdownPath: targetPath,
      jsonPath: jsonTargetPath,
      imagesDir,
      imageCount: written.imageCount,
      batchId: task.batchId,
      zipUrl,
      markdownEntryName: written.markdownEntryName,
      jsonEntryName: written.jsonEntryName
    };
  }
  async _convertPdfBatchToMarkdown({
    items,
    language,
    enableFormula,
    enableTable,
    isOcr,
    modelVersion
  }) {
    this.log("batch:convert:start", {
      count: items.length,
      baseURL: this.baseURL,
      language,
      enableFormula: !!enableFormula,
      enableTable: !!enableTable,
      isOcr: !!isOcr,
      modelVersion: String(modelVersion || "vlm"),
      files: items.map((item) => ({
        sourcePath: item.sourcePath,
        targetPath: item.targetPath
      }))
    });
    const batch = await this.createUploadBatch({
      files: items.map((item) => ({
        fileName: path.basename(item.sourcePath),
        dataId: item.dataId
      })),
      language,
      isOcr,
      enableFormula,
      enableTable,
      modelVersion
    });
    const uploadFiles = Array.isArray(batch.files) ? batch.files : [];
    if (uploadFiles.length < items.length) {
      throw new Error("MinerU \u6279\u91CF\u4E0A\u4F20\u4EFB\u52A1\u54CD\u5E94\u7F3A\u5C11\u6587\u4EF6\u4E0A\u4F20\u5730\u5740");
    }
    await runWithConcurrency(uploadFiles.slice(0, items.length), MAX_UPLOAD_CONCURRENCY, async (file, index) => {
      const fileBuffer = await fs.readFile(items[index].sourcePath);
      await this.uploadPdfToMineru(file.uploadUrl, fileBuffer);
    });
    const status = await this.waitForBatch(batch.batchId);
    const statusFiles = Array.isArray(status?.files) ? status.files : [];
    const statusByDataId = new Map(statusFiles.map((file) => [String(file?.dataId || ""), file]));
    const results = [];
    const failed = [];
    for (const item of items) {
      const fileStatus = statusByDataId.get(item.dataId) || statusFiles[items.indexOf(item)] || null;
      const state = String(fileStatus?.state || "").trim().toLowerCase();
      const zipUrl = String(fileStatus?.zipUrl || "").trim();
      if (state !== "done" || !zipUrl) {
        failed.push({
          ...item,
          state,
          error: getErrorMessage(fileStatus, "MinerU \u89E3\u6790\u5931\u8D25")
        });
        continue;
      }
      try {
        const written = await this.writeZipResult({
          targetPath: item.targetPath,
          zipUrl
        });
        results.push({
          ...item,
          filePath: item.targetPath,
          markdownPath: item.targetPath,
          jsonPath: written.jsonPath,
          imagesDir: written.imagesDir,
          imageCount: written.imageCount,
          batchId: batch.batchId,
          taskId: fileStatus?.taskId || "",
          zipUrl,
          markdownEntryName: written.markdownEntryName,
          jsonEntryName: written.jsonEntryName
        });
      } catch (error) {
        failed.push({
          ...item,
          state,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.log("batch:convert:done", {
      batchId: batch.batchId,
      requestedCount: items.length,
      convertedCount: results.length,
      failedCount: failed.length
    });
    return {
      batchId: batch.batchId,
      requestedCount: items.length,
      results,
      failed
    };
  }
  async writeZipResult({ targetPath, zipUrl }) {
    const outputRoot = path.dirname(targetPath);
    const targetBasePath = targetPath.replace(/\.[^.]+$/, "");
    const jsonTargetPath = `${targetBasePath}.json`;
    const imagesDir = path.join(outputRoot, "images");
    const zipTempPath = `${targetBasePath}.zip.download`;
    if (!isPathInsideOrSameDirectory(imagesDir, outputRoot) || !isPathInsideOrSameDirectory(jsonTargetPath, outputRoot) || !isPathInsideOrSameDirectory(zipTempPath, outputRoot)) {
      throw new Error("MinerU \u8F93\u51FA\u8DEF\u5F84\u8D8A\u754C");
    }
    await fs.mkdir(outputRoot, { recursive: true });
    let extracted = null;
    let outputMarkdown = "";
    try {
      const zipBuffer = await this.downloadZip(zipUrl);
      await fs.writeFile(zipTempPath, zipBuffer);
      extracted = await extractResultFilesFromZip(zipBuffer);
      await fs.rm(imagesDir, { recursive: true, force: true });
      await runWithConcurrency(extracted.images, MAX_ZIP_IMAGE_IO_CONCURRENCY, async (image) => {
        if (!image.relativePath) {
          return;
        }
        const outputImagePath = path.resolve(outputRoot, image.relativePath);
        if (!isPathInsideOrSameDirectory(outputImagePath, imagesDir)) {
          throw new Error(`MinerU zip \u56FE\u7247\u8DEF\u5F84\u8D8A\u754C: ${image.relativePath}`);
        }
        await fs.mkdir(path.dirname(outputImagePath), { recursive: true });
        await fs.writeFile(outputImagePath, image.buffer);
      });
      let normalizedMarkdown = "";
      try {
        const normalizedLayout = await normalizeMineruMarkdownLayout({
          markdown: extracted.markdown,
          jsonText: extracted.jsonText,
          outputDir: outputRoot
        });
        normalizedMarkdown = normalizedLayout.markdown;
      } catch (error) {
        if (!String(extracted.markdown || "").trim()) {
          throw error;
        }
        this.log("layout:normalization-skipped", {
          message: String(error?.message || error || "unknown error")
        });
      }
      outputMarkdown = selectPreferredMarkdownOutput({
        sourceMarkdown: extracted.markdown,
        normalizedMarkdown
      });
      this.log("markdown:select-output", {
        sourceLength: extracted.markdown.length,
        normalizedLength: normalizedMarkdown.length,
        outputLength: outputMarkdown.length,
        sourceTextCharacters: getMarkdownTextCharacterCount(extracted.markdown),
        normalizedTextCharacters: getMarkdownTextCharacterCount(normalizedMarkdown)
      });
      await Promise.all([
        fs.writeFile(targetPath, outputMarkdown, "utf8"),
        fs.writeFile(jsonTargetPath, extracted.jsonText, "utf8")
      ]);
    } finally {
      await fs.unlink(zipTempPath).catch(() => {
      });
    }
    return {
      filePath: targetPath,
      markdownPath: targetPath,
      jsonPath: jsonTargetPath,
      imagesDir,
      imageCount: extracted.images.length,
      markdownEntryName: extracted.markdownEntryName,
      jsonEntryName: extracted.jsonEntryName,
      markdownLength: outputMarkdown.length,
      jsonLength: extracted.jsonText.length
    };
  }
  async createUploadTask({
    fileName,
    dataId,
    language,
    isOcr,
    enableFormula,
    enableTable,
    modelVersion
  }) {
    const requestBody = {
      fileName: String(fileName || "").trim(),
      language: String(language || "ch").trim() || "ch",
      isOcr: !!isOcr,
      enableFormula: !!enableFormula,
      enableTable: !!enableTable,
      modelVersion: String(modelVersion || "vlm").trim() || "vlm"
    };
    if (String(dataId || "").trim()) {
      requestBody.dataId = String(dataId).trim();
    }
    this.log("task:create:request", requestBody);
    const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.clientKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }, FETCH_JSON_TIMEOUT_MS);
    const payload = await parseJSONResponse(response, "\u521B\u5EFA MinerU \u4E0A\u4F20\u4EFB\u52A1\u5931\u8D25");
    if (!payload?.batchId || !payload?.uploadUrl) {
      throw new Error(getErrorMessage(payload, "MinerU \u4E0A\u4F20\u4EFB\u52A1\u54CD\u5E94\u7F3A\u5C11 batchId \u6216 uploadUrl"));
    }
    this.log("task:create:response", {
      batchId: payload.batchId,
      uploadUrl: sanitizeUrlForLog(payload.uploadUrl),
      dataId: payload.dataId || "",
      remainingBalance: payload.remainingBalance
    });
    return payload;
  }
  async createUploadBatch({
    files = [],
    language,
    isOcr,
    enableFormula,
    enableTable,
    modelVersion
  }) {
    const requestBody = {
      files: files.map((file) => ({
        fileName: String(file?.fileName || "").trim(),
        dataId: String(file?.dataId || "").trim()
      })).filter((file) => file.fileName).map((file) => file.dataId ? { fileName: file.fileName, dataId: file.dataId } : { fileName: file.fileName }),
      language: String(language || "ch").trim() || "ch",
      isOcr: !!isOcr,
      enableFormula: !!enableFormula,
      enableTable: !!enableTable,
      modelVersion: String(modelVersion || "vlm").trim() || "vlm"
    };
    this.log("batch:create:request", {
      ...requestBody,
      files: requestBody.files.map((file) => ({
        fileName: file.fileName,
        dataId: file.dataId
      }))
    });
    const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-task-batches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.clientKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }, FETCH_JSON_TIMEOUT_MS);
    const payload = await parseJSONResponse(response, "\u521B\u5EFA MinerU \u6279\u91CF\u4E0A\u4F20\u4EFB\u52A1\u5931\u8D25");
    if (!payload?.batchId || !Array.isArray(payload?.files)) {
      throw new Error(getErrorMessage(payload, "MinerU \u6279\u91CF\u4E0A\u4F20\u4EFB\u52A1\u54CD\u5E94\u7F3A\u5C11 batchId \u6216 files"));
    }
    this.log("batch:create:response", {
      batchId: payload.batchId,
      fileCount: payload.files.length,
      remainingBalance: payload.remainingBalance
    });
    return payload;
  }
  async uploadPdfToMineru(uploadUrl, fileBuffer) {
    const parsedUploadUrl = parseHttpUrl(uploadUrl, "MinerU upload");
    this.log("upload:start", {
      uploadUrl: sanitizeUrlForLog(parsedUploadUrl.toString()),
      size: fileBuffer.length
    });
    const uploadTimeoutMs = Math.max(FETCH_UPLOAD_BASE_TIMEOUT_MS, Math.ceil(fileBuffer.length / (1024 * 1024) * 15e3));
    const response = await fetchWithTimeout(parsedUploadUrl, {
      method: "PUT",
      body: fileBuffer
    }, uploadTimeoutMs);
    if (!response.ok) {
      throw new Error(`\u4E0A\u4F20 PDF \u5230 MinerU \u5931\u8D25 (${response.status})`);
    }
    this.log("upload:done", {
      status: response.status
    });
  }
  async queryUploadTask(batchId) {
    const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-tasks/${encodeURIComponent(batchId)}`, {
      headers: {
        Authorization: `Bearer ${this.clientKey}`
      }
    }, FETCH_JSON_TIMEOUT_MS);
    return parseJSONResponse(response, "\u67E5\u8BE2 MinerU \u4E0A\u4F20\u4EFB\u52A1\u5931\u8D25");
  }
  async queryUploadTaskBatch(batchId) {
    const response = await fetchWithTimeout(`${this.baseURL}/v1/mineru/upload-task-batches/${encodeURIComponent(batchId)}`, {
      headers: {
        Authorization: `Bearer ${this.clientKey}`
      }
    }, FETCH_JSON_TIMEOUT_MS);
    return parseJSONResponse(response, "\u67E5\u8BE2 MinerU \u6279\u91CF\u4E0A\u4F20\u4EFB\u52A1\u5931\u8D25");
  }
  async waitForTask(batchId) {
    const deadline = Date.now() + this.timeoutMs;
    let lastState = "";
    while (Date.now() < deadline) {
      const status = await this.queryUploadTask(batchId);
      const normalizedState = String(status?.state || "").trim().toLowerCase();
      if (normalizedState !== lastState) {
        lastState = normalizedState;
        this.log("task:poll", {
          batchId,
          state: normalizedState,
          progress: status?.progress || null,
          errMsg: status?.errMsg || ""
        });
      }
      if (normalizedState === "done") {
        return status;
      }
      if (normalizedState === "failed") {
        throw new Error(getErrorMessage(status, "MinerU \u89E3\u6790\u5931\u8D25"));
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error("\u7B49\u5F85 MinerU Markdown \u7ED3\u679C\u8D85\u65F6");
  }
  async waitForBatch(batchId) {
    const deadline = Date.now() + this.timeoutMs;
    let lastSummary = "";
    while (Date.now() < deadline) {
      const status = await this.queryUploadTaskBatch(batchId);
      const files = Array.isArray(status?.files) ? status.files : [];
      const summary = files.map((file) => `${file?.dataId || file?.fileName || ""}:${String(file?.state || "").toLowerCase()}`).join("|");
      if (summary !== lastSummary) {
        lastSummary = summary;
        this.log("batch:poll", {
          batchId,
          files: files.map((file) => ({
            fileName: file?.fileName || "",
            dataId: file?.dataId || "",
            state: file?.state || "",
            progress: file?.progress || null,
            errMsg: file?.errMsg || ""
          }))
        });
      }
      if (files.length > 0 && files.every((file) => {
        const state = String(file?.state || "").trim().toLowerCase();
        return state === "done" || state === "failed";
      })) {
        return status;
      }
      await sleep(this.pollIntervalMs);
    }
    throw new Error("\u7B49\u5F85 MinerU \u6279\u91CF Markdown \u7ED3\u679C\u8D85\u65F6");
  }
  async downloadZip(zipUrl) {
    const parsedZipUrl = parseHttpUrl(zipUrl, "MinerU zip");
    const safeZipUrl = sanitizeUrlForLog(parsedZipUrl.toString());
    this.log("zip:download:start", { zipUrl: safeZipUrl });
    const response = await fetchWithTimeout(parsedZipUrl, {}, FETCH_DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`\u4E0B\u8F7D MinerU zip \u5931\u8D25 (${response.status})`);
    }
    const buffer = await readResponseBodyWithLimit(response, MAX_ZIP_BYTES, "MinerU zip");
    this.log("zip:download:done", {
      zipUrl: safeZipUrl,
      size: buffer.length
    });
    return buffer;
  }
  async dispose() {
  }
  log(stage, payload) {
    try {
      this.logger?.log?.(`[mineru-upload] ${stage} ${JSON.stringify(payload)}`);
    } catch (error) {
      this.logger?.log?.(`[mineru-upload] ${stage}`, payload, error);
    }
  }
};
module.exports = {
  MineruMarkdownService,
  selectPreferredMarkdownOutput
};
