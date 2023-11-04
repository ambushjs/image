let { ok } = require('assert');
let { kMaxLength } = require('buffer');
let zlib = require('zlib');
let util = require('util');

function paethPredictor(left, above, upLeft) {
    let paeth = left + above - upLeft;
    let pLeft = Math.abs(paeth - left);
    let pAbove = Math.abs(paeth - above);
    let pUpLeft = Math.abs(paeth - upLeft);

    if (pLeft <= pAbove && pLeft <= pUpLeft) return left;
    if (pAbove <= pUpLeft) return above;

    return upLeft;
}

let crcTable = [];
let imagePasses = [
    {
        x: [0],
        y: [0],
    },
    {
        x: [4],
        y: [0],
    },
    {
        x: [0, 4],
        y: [4],
    },
    {
        x: [2, 6],
        y: [0, 4],
    },
    {
        x: [0, 2, 4, 6],
        y: [2, 6],
    },
    {
        x: [1, 3, 5, 7],
        y: [0, 2, 4, 6],
    },
    {
        x: [0, 1, 2, 3, 4, 5, 6, 7],
        y: [1, 3, 5, 7],
    },
];

const interlaceUtils = {
    getImagePasses(width, height) {
        let images = [];
        let xLeftOver = width % 8;
        let yLeftOver = height % 8;
        let xRepeats = (width - xLeftOver) / 8;
        let yRepeats = (height - yLeftOver) / 8;

        for (let i = 0; i < imagePasses.length; i++) {
            let pass = imagePasses[i];
            let passWidth = xRepeats * pass.x.length;
            let passHeight = yRepeats * pass.y.length;

            for (let j = 0; j < pass.x.length; j++) {
                if (pass.x[j] < xLeftOver) passWidth++;
                else break;
            }

            for (let j = 0; j < pass.y.length; j++) {
                if (pass.y[j] < yLeftOver) passHeight++;
                else break;
            }

            if (passWidth > 0 && passHeight > 0) images.push({ width: passWidth, height: passHeight, index: i });
        }

        return images;
    },
    getInterlaceIterator(width) {
        return function interlaceIterator(x, y, pass) {
            let outerXLeftOver = x % imagePasses[pass].x.length;
            let outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
            let outerYLeftOver = y % imagePasses[pass].y.length;
            let outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];

            return outerX * 4 + outerY * width * 4;
        };
    },
};

for (let i = 0; i < 256; i++) {
    let currentCrc = i;

    for (let j = 0; j < 8; j++) {
        if (currentCrc & 1) currentCrc = 0xedb88320 ^ currentCrc >>> 1;
        else currentCrc = currentCrc >>> 1;
    }

    crcTable[i] = currentCrc;
}

class CrcStream {
    constructor() {
        this._crc = -1;
    }

    write(data) {
        for (let i = 0; i < data.length; i++) {
            this._crc = crcTable[(this._crc ^ data[i]) & 0xff] ^ this._crc >>> 8;
        }

        return true;
    }

    crc32() {
        return this._crc ^ -1;
    }
}

function crc32(buf) {
    let crc = -1;

    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xff] ^ crc >>> 8;
    }

    return crc ^ -1;
}

const constants = {
    PNG_SIGNATURE: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],

    TYPE_IHDR: 0x49484452,
    TYPE_IEND: 0x49454e44,
    TYPE_IDAT: 0x49444154,
    TYPE_PLTE: 0x504c5445,
    TYPE_tRNS: 0x74524e53,
    TYPE_gAMA: 0x67414d41,

    COLORTYPE_GRAYSCALE: 0,
    COLORTYPE_PALETTE: 1,
    COLORTYPE_COLOR: 2,
    COLORTYPE_ALPHA: 4,

    COLORTYPE_PALETTE_COLOR: 3,
    COLORTYPE_COLOR_ALPHA: 6,

    COLORTYPE_TO_BPP_MAP: {
        0: 1,
        2: 3,
        3: 1,
        4: 2,
        6: 4,
    },

    GAMMA_DIVISION: 100000,
};

class Parser {
    constructor(options, dependencies) {
        this._options = options;
        options.checkCRC = options.checkCRC !== false;

        this._hasIHDR = false;
        this._hasIEND = false;
        this._emittedHeadersFinished = false;

        this._palette = [];
        this._colorType = 0;

        this._chunks = {};
        this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
        this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
        this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
        this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
        this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
        this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);

        this.read = dependencies.read;
        this.error = dependencies.error;
        this.metadata = dependencies.metadata;
        this.gamma = dependencies.gamma;
        this.transColor = dependencies.transColor;
        this.palette = dependencies.palette;
        this.parsed = dependencies.parsed;
        this.inflateData = dependencies.inflateData;
        this.finished = dependencies.finished;
        this.simpleTransparency = dependencies.simpleTransparency;
        this.headersFinished = dependencies.headersFinished || function empty() {};
    }

    start() {
        this.read(constants.PNG_SIGNATURE.length, this._parseSignature.bind(this));
    }

    _parseSignature(data) {
        let signature = constants.PNG_SIGNATURE;

        for (let i = 0; i < signature.length; i++) {
            if (data[i] !== signature[i]) {
                return this.error(new Error('Invalid file signature'));
            }
        }

        this.read(8, this._parseChunkBegin.bind(this));
    }

    _parseChunkBegin(data) {
        let length = data.readUInt32BE(0);
        let type = data.readUInt32BE(4);
        let name = '';

        for (let i = 4; i < 8; i++) {
            name += String.fromCharCode(data[i]);
        }

        let ancillary = Boolean(data[4] & 0x20);

        if (!this._hasIHDR && type !== constants.TYPE_IHDR) return this.error(new Error('Expected IHDR on beggining'));

        this._crc = new CrcStream();
        this._crc.write(Buffer.from(name));

        if (this._chunks[type]) return this._chunks[type](length);
        if (!ancillary) return this.error(new Error(`Unsupported critical chunk type ${ name}`));

        this.read(length + 4, this._skipChunk.bind(this));
    }

    _skipChunk() {
        this.read(8, this._parseChunkBegin.bind(this));
    }

    _handleChunkEnd() {
        this.read(4, this._parseChunkEnd.bind(this));
    }

    _parseChunkEnd(data) {
        let fileCrc = data.readInt32BE(0);
        let calcCrc = this._crc.crc32();

        if (this._options.checkCRC && calcCrc !== fileCrc) return this.error(new Error(`Crc error - ${ fileCrc } - ${ calcCrc}`));
        if (!this._hasIEND) this.read(8, this._parseChunkBegin.bind(this));
    }

    _handleIHDR(length) {
        this.read(length, this._parseIHDR.bind(this));
    }

    _parseIHDR(data) {
        this._crc.write(data);

        let width = data.readUInt32BE(0);
        let height = data.readUInt32BE(4);
        let depth = data[8];
        let colorType = data[9];
        let compr = data[10];
        let filter = data[11];
        let interlace = data[12];

        if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) return this.error(new Error(`Unsupported bit depth ${ depth}`));
        if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) return this.error(new Error('Unsupported color type'));
        if (compr !== 0) return this.error(new Error('Unsupported compression method'));
        if (filter !== 0) return this.error(new Error('Unsupported filter method'));
        if (interlace !== 0 && interlace !== 1) return this.error(new Error('Unsupported interlace method'));

        this._colorType = colorType;

        let bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];

        this._hasIHDR = true;

        this.metadata({
            width,
            height,
            depth,
            interlace: Boolean(interlace),
            palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
            color: Boolean(colorType & constants.COLORTYPE_COLOR),
            alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
            bpp,
            colorType,
        });

        this._handleChunkEnd();
    }

    _handlePLTE(length) {
        this.read(length, this._parsePLTE.bind(this));
    }

    _parsePLTE(data) {
        this._crc.write(data);

        let entries = Math.floor(data.length / 3);

        for (let i = 0; i < entries; i++) {
            this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 0xff]);
        }

        this.palette(this._palette);
        this._handleChunkEnd();
    }

    _handleTRNS(length) {
        this.simpleTransparency();
        this.read(length, this._parseTRNS.bind(this));
    }

    _parseTRNS(data) {
        this._crc.write(data);

        if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
            if (this._palette.length === 0) return this.error(new Error('Transparency chunk must be after palette'));
            if (data.length > this._palette.length) return this.error(new Error('More transparent colors than palette size'));

            for (let i = 0; i < data.length; i++) {
                return this._palette[i][3] = data[i];
            }

            this.palette(this._palette);
        }

        if (this._colorType === constants.COLORTYPE_GRAYSCALE) this.transColor([data.readUInt16BE(0)]);

        if (this._colorType === constants.COLORTYPE_COLOR) {
            this.transColor([
                data.readUInt16BE(0),
                data.readUInt16BE(2),
                data.readUInt16BE(4),
            ]);
        }

        this._handleChunkEnd();
    }

    _handleGAMA(length) {
        this.read(length, this._parseGAMA.bind(this));
    }

    _parseGAMA(data) {
        this._crc.write(data);
        this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);
        this._handleChunkEnd();
    }

    _handleIDAT(length) {
        if (!this._emittedHeadersFinished) {
            this._emittedHeadersFinished = true;
            this.headersFinished();
        }

        this.read(-length, this._parseIDAT.bind(this, length));
    }

    _parseIDAT(length, data) {
        this._crc.write(data);

        if (this._colorType === constants.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
            throw new Error('Expected palette not found');
        }

        this.inflateData(data);

        let leftOverLength = length - data.length;

        if (leftOverLength > 0) this._handleIDAT(leftOverLength);
        else this._handleChunkEnd();
    }

    _handleIEND(length) {
        this.read(length, this._parseIEND.bind(this));
    }

    _parseIEND(data) {
        this._crc.write(data);

        this._hasIEND = true;
        this._handleChunkEnd();

        if (this.finished) this.finished();
    }
}

function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
    for (let x = 0; x < byteWidth; x++) {
        rawData[rawPos + x] = pxData[pxPos + x];
    }
}

function filterSumNone(pxData, pxPos, byteWidth) {
    let sum = 0;
    let length = pxPos + byteWidth;

    for (let i = pxPos; i < length; i++) {
        sum += Math.abs(pxData[i]);
    }

    return sum;
}

function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
    for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;

        rawData[rawPos + x] = val;
    }
}

function filterSumSub(pxData, pxPos, byteWidth, bpp) {
    let sum = 0;

    for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;

        sum += Math.abs(val);
    }

    return sum;
}

function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
    for (let x = 0; x < byteWidth; x++) {
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - up;

        rawData[rawPos + x] = val;
    }
}

function filterSumUp(pxData, pxPos, byteWidth) {
    let sum = 0;
    let length = pxPos + byteWidth;

    for (let x = pxPos; x < length; x++) {
        let up = pxPos > 0 ? pxData[x - byteWidth] : 0;
        let val = pxData[x] - up;

        sum += Math.abs(val);
    }

    return sum;
}

function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
    for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);

        rawData[rawPos + x] = val;
    }
}

function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
    let sum = 0;

    for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);

        sum += Math.abs(val);
    }

    return sum;
}

function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
    for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);

        rawData[rawPos + x] = val;
    }
}

function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
    let sum = 0;

    for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);

        sum += Math.abs(val);
    }

    return sum;
}

let filters = {
    0: filterNone,
    1: filterSub,
    2: filterUp,
    3: filterAvg,
    4: filterPaeth,
};

let filterSums = {
    0: filterSumNone,
    1: filterSumSub,
    2: filterSumUp,
    3: filterSumAvg,
    4: filterSumPaeth,
};

function filterPacked(pxData, width, height, options, oldBpp) {
    let bpp = oldBpp;
    let filterTypes = [];

    if (!('filterType' in options) || options.filterType === -1) filterTypes = [0, 1, 2, 3, 4];
    else if (typeof options.filterType === 'number') filterTypes = [options.filterType];
    else throw new Error('unrecognised filter types');

    if (options.bitDepth === 16) bpp *= 2;

    let byteWidth = width * bpp;
    let rawPos = 0;
    let pxPos = 0;
    let rawData = Buffer.alloc((byteWidth + 1) * height);
    let sel = filterTypes[0];

    for (let y = 0; y < height; y++) {
        if (filterTypes.length > 1) {
            let min = Infinity;

            for (let i = 0; i < filterTypes.length; i++) {
                let sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);

                if (sum < min) {
                    sel = filterTypes[i];
                    min = sum;
                }
            }
        }

        rawData[rawPos] = sel;
        rawPos++;
        filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
        rawPos += byteWidth;
        pxPos += byteWidth;
    }

    return rawData;
}

function bitPacker(dataIn, width, height, options) {
    let outHasAlpha =[constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(options.colorType) !== -1;

    if (options.colorType === options.inputColorType) {
        let buffer = new ArrayBuffer(2);

        new DataView(buffer).setInt16(0, 256, true);

        let bigEndian = new Int16Array(buffer)[0] !== 256;

        if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) return dataIn;
    }

    let data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
    let maxValue = 255;
    let inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];

    if (inBpp === 4 && !options.inputHasAlpha) inBpp = 3;

    let outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];

    if (options.bitDepth === 16) {
        maxValue = 65535;
        outBpp *= 2;
    }

    let outData = Buffer.alloc(width * height * outBpp);
    let inIndex = 0;
    let outIndex = 0;

    let bgColor = options.bgColor || {};

    if (bgColor.red === undefined) bgColor.red = maxValue;
    if (bgColor.green === undefined) bgColor.green = maxValue;
    if (bgColor.blue === undefined) bgColor.blue = maxValue;

    function getRGBA() {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = maxValue;

        switch (options.inputColorType) {
        case constants.COLORTYPE_COLOR_ALPHA:
            alpha = data[inIndex + 3];
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
        case constants.COLORTYPE_COLOR:
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
        case constants.COLORTYPE_ALPHA:
            alpha = data[inIndex + 1];
            red = data[inIndex];
            green = red;
            blue = red;
            break;
        case constants.COLORTYPE_GRAYSCALE:
            red = data[inIndex];
            green = red;
            blue = red;
            break;
        default:
            throw new Error(`input color type: ${options.inputColorType} is not supported at present`);
        }

        if (options.inputHasAlpha) {
            if (!outHasAlpha) {
                alpha /= maxValue;
                red = Math.min(Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0), maxValue);
                green = Math.min(Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0), maxValue);
                blue = Math.min(Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0), maxValue);
            }
        }

        return { red, green, blue, alpha };
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let rgba = getRGBA(data, inIndex);

            switch (options.colorType) {
            case constants.COLORTYPE_COLOR_ALPHA:
            case constants.COLORTYPE_COLOR:
                if (options.bitDepth === 8) {
                    outData[outIndex] = rgba.red;
                    outData[outIndex + 1] = rgba.green;
                    outData[outIndex + 2] = rgba.blue;

                    if (outHasAlpha) outData[outIndex + 3] = rgba.alpha;
                } else {
                    outData.writeUInt16BE(rgba.red, outIndex);
                    outData.writeUInt16BE(rgba.green, outIndex + 2);
                    outData.writeUInt16BE(rgba.blue, outIndex + 4);

                    if (outHasAlpha) outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                }

                break;
            case constants.COLORTYPE_ALPHA:
            case constants.COLORTYPE_GRAYSCALE: {
                let grayscale = (rgba.red + rgba.green + rgba.blue) / 3;

                if (options.bitDepth === 8) {
                    outData[outIndex] = grayscale;

                    if (outHasAlpha) outData[outIndex + 1] = rgba.alpha;
                } else {
                    outData.writeUInt16BE(grayscale, outIndex);

                    if (outHasAlpha) outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                }

                break;
            }
            default:
                throw new Error(`unrecognised color Type ${ options.colorType}`);
            }

            inIndex += inBpp;
            outIndex += outBpp;
        }
    }

    return outData;
}

class Packer {
    constructor(options) {
        this._options = options;

        options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
        options.deflateLevel = options.deflateLevel !== null ? options.deflateLevel : 9;
        options.deflateStrategy = options.deflateStrategy !== null ? options.deflateStrategy : 3;
        options.inputHasAlpha = options.inputHasAlpha !== null ? options.inputHasAlpha : true;
        options.deflateFactory = options.deflateFactory || zlib.createDeflate;
        options.bitDepth = options.bitDepth || 8;
        options.colorType = typeof options.colorType === 'number' ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
        options.inputColorType = typeof options.inputColorType === 'number' ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;

        if ([constants.COLORTYPE_GRAYSCALE, constants.COLORTYPE_COLOR, constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(options.colorType) === -1) {
            throw new Error(`option color type: ${options.colorType} is not supported at present`);
        }

        if ([constants.COLORTYPE_GRAYSCALE, constants.COLORTYPE_COLOR, constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA,].indexOf(options.inputColorType) === -1) {
            throw new Error(`option input color type: ${options.inputColorType} is not supported at present`);
        }

        if (options.bitDepth !== 8 && options.bitDepth !== 16) {
            throw new Error(`option bit depth: ${ options.bitDepth } is not supported at present`);
        }
    }

    getDeflateOptions() {
        return {
            chunkSize: this._options.deflateChunkSize,
            level: this._options.deflateLevel,
            strategy: this._options.deflateStrategy,
        };
    }

    createDeflate() {
        return this._options.deflateFactory(this.getDeflateOptions());
    }

    filterData(data, width, height) {
        let packedData = bitPacker(data, width, height, this._options);

        let bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
        let filteredData = filterPacked(packedData, width, height, this._options, bpp);
        return filteredData;
    }

    _packChunk(type, data) {
        let len = data ? data.length : 0;
        let buf = Buffer.alloc(len + 12);

        buf.writeUInt32BE(len, 0);
        buf.writeUInt32BE(type, 4);

        if (data) data.copy(buf, 8);

        buf.writeInt32BE(
            crc32(buf.subarray(4, buf.length - 4)),
            buf.length - 4
        );

        return buf;
    }

    packGAMA(gamma) {
        let buf = Buffer.alloc(4);

        buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);

        return this._packChunk(constants.TYPE_gAMA, buf);
    }
    packIHDR(width, height) {
        let buf = Buffer.alloc(13);

        buf.writeUInt32BE(width, 0);
        buf.writeUInt32BE(height, 4);

        buf[8] = this._options.bitDepth;
        buf[9] = this._options.colorType;
        buf[10] = 0;
        buf[11] = 0;
        buf[12] = 0;

        return this._packChunk(constants.TYPE_IHDR, buf);
    }

    packIDAT(data) {
        return this._packChunk(constants.TYPE_IDAT, data);
    }

    packIEND() {
        return this._packChunk(constants.TYPE_IEND, null);
    }
}

function pack(metaData, opt) {
    let options = opt || {};
    let packer = new Packer(options);
    let chunks = [];

    chunks.push(Buffer.from(constants.PNG_SIGNATURE));
    chunks.push(packer.packIHDR(metaData.width, metaData.height));

    if (metaData.gamma) chunks.push(packer.packGAMA(metaData.gamma));

    let filteredData = packer.filterData(metaData.data, metaData.width, metaData.height);
    let compressedData = zlib.deflateSync(filteredData, packer.getDeflateOptions());

    filteredData = null;

    if (!compressedData || !compressedData.length) throw new Error('bad png - invalid compressed data response');

    chunks.push(packer.packIDAT(compressedData));
    chunks.push(packer.packIEND());

    return Buffer.concat(chunks);
}

function _close(engine, callback) {
    if (callback) process.nextTick(callback);
    if (!engine._handle) return;

    engine._handle.close();
    engine._handle = null;
}

class Inflate {
    constructor(opts) {
        if (!(this instanceof Inflate)) return new Inflate(opts);
        if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) opts.chunkSize = zlib.Z_MIN_CHUNK;

        zlib.Inflate.call(this, opts);

        this._offset = this._offset === undefined ? this._outOffset : this._offset;
        this._buffer = this._buffer || this._outBuffer;

        if (opts && opts.maxLength !== null) this._maxLength = opts.maxLength;
    }

    _processChunk(chunk, flushFlag, asyncCb) {
        if (typeof asyncCb === 'function') return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);

        let self = this;
        let availInBefore = chunk && chunk.length;
        let availOutBefore = this._chunkSize - this._offset;
        let leftToInflate = this._maxLength;
        let inOff = 0;
        let buffers = [];
        let nread = 0;
        let error = null;

        this.on('error', (err) => error = err);

        function handleChunk(availInAfter, availOutAfter) {
            if (self._hadError) return;

            let have = availOutBefore - availOutAfter;

            ok(have >= 0, 'have should not go down');

            if (have > 0) {
                let out = self._buffer.slice(self._offset, self._offset + have);

                self._offset += have;

                if (out.length > leftToInflate) out = out.slice(0, leftToInflate);

                buffers.push(out);

                nread += out.length;
                leftToInflate -= out.length;

                if (leftToInflate === 0) return false;
            }

            if (availOutAfter === 0 || self._offset >= self._chunkSize) {
                availOutBefore = self._chunkSize;
                self._offset = 0;
                self._buffer = Buffer.allocUnsafe(self._chunkSize);
            }

            if (availOutAfter === 0) {
                inOff += availInBefore - availInAfter;
                availInBefore = availInAfter;

                return true;
            }

            return false;
        }

        ok(this._handle, 'zlib binding closed');

        let res = null;

        do {
            res = this._handle.writeSync(
                flushFlag,
                chunk,
                inOff,
                availInBefore,
                this._buffer,
                this._offset,
                availOutBefore
            );

            res = res || this._writeState;
        } while (!this._hadError && handleChunk(res[0], res[1]));

        if (this._hadError) throw error;

        if (nread >= kMaxLength) {
            _close(this);

            throw new RangeError(`Cannot create final Buffer. It would be larger than 0x${kMaxLength.toString(16)} bytes`);
        }

        let buf = Buffer.concat(buffers, nread);

        _close(this);

        return buf;
    }
}

util.inherits(Inflate, zlib.Inflate);

function zlibBufferSync(engine, oldBuffer) {
    let buffer = oldBuffer;

    if (typeof buffer === 'string') buffer = Buffer.from(buffer);
    else if (!(buffer instanceof Buffer)) throw new TypeError('Not a string or buffer');

    let flushFlag = engine._finishFlushFlag;

    if (flushFlag === null) flushFlag = zlib.constants.Z_FINISH;

    return engine._processChunk(buffer, flushFlag);
}

function inflateSync(buffer, opts) {
    return zlibBufferSync(new Inflate(opts), buffer);
}

class SyncReader {
    constructor(buffer) {
        this._buffer = buffer;
        this._reads = [];
    }

    read(length, callback) {
        this._reads.push({
            length: Math.abs(length),
            allowLess: length < 0,
            func: callback,
        });
    }

    process() {
        while (this._reads.length > 0 && this._buffer.length) {
            let read = this._reads[0];

            if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
                this._reads.shift();

                let buf = this._buffer;

                this._buffer = buf.slice(read.length);

                read.func.call(this, buf.slice(0, read.length));
            } else break;
        }

        if (this._reads.length > 0) {
            throw new Error('There are some read requests waiting on the finished stream');
        }

        if (this._buffer.length > 0) {
            throw new Error('Unrecognized content at the end of the stream');
        }
    }
}

function getByteWidth(width, bpp, depth) {
    let byteWidth = width * bpp;

    if (depth !== 8) {
        byteWidth = Math.ceil(byteWidth / (8 / depth));
    }

    return byteWidth;
}

class Filter {
    constructor(bitmapInfo, dependencies) {
        let width = bitmapInfo.width;
        let height = bitmapInfo.height;
        let interlace = bitmapInfo.interlace;
        let bpp = bitmapInfo.bpp;
        let depth = bitmapInfo.depth;

        this.read = dependencies.read;
        this.write = dependencies.write;
        this.complete = dependencies.complete;

        this._imageIndex = 0;
        this._images = [];

        if (interlace) {
            let passes = interlaceUtils.getImagePasses(width, height);

            for (let i = 0; i < passes.length; i++) {
                this._images.push({
                    byteWidth: getByteWidth(passes[i].width, bpp, depth),
                    height: passes[i].height,
                    lineIndex: 0,
                });
            }
        } else {
            this._images.push({
                byteWidth: getByteWidth(width, bpp, depth),
                height,
                lineIndex: 0,
            });
        }

        if (depth === 8) this._xComparison = bpp;
        else if (depth === 16) this._xComparison = bpp * 2;
        else this._xComparison = 1;
    }

    start() {
        this.read(
            this._images[this._imageIndex].byteWidth + 1,
            this._reverseFilterLine.bind(this)
        );
    }

    _unFilterType1(rawData, unfilteredLine, byteWidth) {
        let xComparison = this._xComparison;
        let xBiggerThan = xComparison - 1;

        for (let x = 0; x < byteWidth; x++) {
            let rawByte = rawData[1 + x];
            let f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;

            unfilteredLine[x] = rawByte + f1Left;
        }
    }

    _unFilterType2(rawData, unfilteredLine, byteWidth) {
        let lastLine = this._lastLine;

        for (let x = 0; x < byteWidth; x++) {
            let rawByte = rawData[1 + x];
            let f2Up = lastLine ? lastLine[x] : 0;

            unfilteredLine[x] = rawByte + f2Up;
        }
    }

    _unFilterType3(rawData, unfilteredLine, byteWidth) {
        let xComparison = this._xComparison;
        let xBiggerThan = xComparison - 1;
        let lastLine = this._lastLine;

        for (let x = 0; x < byteWidth; x++) {
            let rawByte = rawData[1 + x];
            let f3Up = lastLine ? lastLine[x] : 0;
            let f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
            let f3Add = Math.floor((f3Left + f3Up) / 2);

            unfilteredLine[x] = rawByte + f3Add;
        }
    }

    _unFilterType4(rawData, unfilteredLine, byteWidth) {
        let xComparison = this._xComparison;
        let xBiggerThan = xComparison - 1;
        let lastLine = this._lastLine;

        for (let x = 0; x < byteWidth; x++) {
            let rawByte = rawData[1 + x];
            let f4Up = lastLine ? lastLine[x] : 0;
            let f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
            let f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
            let f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);

            unfilteredLine[x] = rawByte + f4Add;
        }
    }

    _reverseFilterLine(rawData) {
        let filter = rawData[0];
        let unfilteredLine = null;
        let currentImage = this._images[this._imageIndex];
        let byteWidth = currentImage.byteWidth;

        if (filter === 0) unfilteredLine = rawData.slice(1, byteWidth + 1);
        else {
            unfilteredLine = Buffer.alloc(byteWidth);

            switch (filter) {
            case 1:
                this._unFilterType1(rawData, unfilteredLine, byteWidth);
                break;
            case 2:
                this._unFilterType2(rawData, unfilteredLine, byteWidth);
                break;
            case 3:
                this._unFilterType3(rawData, unfilteredLine, byteWidth);
                break;
            case 4:
                this._unFilterType4(rawData, unfilteredLine, byteWidth);
                break;
            default:
                throw new Error(`Unrecognised filter type - ${filter}`);
            }
        }

        this.write(unfilteredLine);
        currentImage.lineIndex++;

        if (currentImage.lineIndex >= currentImage.height) {
            this._lastLine = null;
            this._imageIndex++;
            currentImage = this._images[this._imageIndex];
        } else this._lastLine = unfilteredLine;

        if (currentImage) this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
        else {
            this._lastLine = null;
            this.complete();
        }
    }
}

function FilterSync(inBuffer, bitmapInfo) {
    let outBuffers = [];
    let reader = new SyncReader(inBuffer);

    let filter = new Filter(bitmapInfo, {
        read: reader.read.bind(reader),
        write (bufferPart) {
            outBuffers.push(bufferPart);
        },
        complete() {},
    });

    filter.start();
    reader.process();

    return Buffer.concat(outBuffers);
}

function dePalette(indata, outdata, width, height, palette) {
    let pxPos = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let color = palette[indata[pxPos]];

            if (!color) throw new Error(`index ${ indata[pxPos] } not in palette`);

            for (let i = 0; i < 4; i++) {
                outdata[pxPos + i] = color[i];
            }

            pxPos += 4;
        }
    }
}

function replaceTransparentColor(indata, outdata, width, height, transColor) {
    let pxPos = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let makeTrans = false;

            if (transColor.length === 1) {
                if (transColor[0] === indata[pxPos]) makeTrans = true;
            } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) makeTrans = true;

            if (makeTrans) {
                for (let i = 0; i < 4; i++) {
                    outdata[pxPos + i] = 0;
                }
            }

            pxPos += 4;
        }
    }
}

function scaleDepth(indata, outdata, width, height, depth) {
    let maxOutSample = 255;
    let maxInSample = Math.pow(2, depth) - 1;
    let pxPos = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let i = 0; i < 4; i++) {
                outdata[pxPos + i] = Math.floor(indata[pxPos + i] * maxOutSample / maxInSample + 0.5);
            }

            pxPos += 4;
        }
    }
}

function formatNormaliser(indata, imageData, skipRescale = false) {
    let depth = imageData.depth;
    let width = imageData.width;
    let height = imageData.height;
    let colorType = imageData.colorType;
    let transColor = imageData.transColor;
    let palette = imageData.palette;
    let outdata = indata;

    if (colorType === 3) dePalette(indata, outdata, width, height, palette);
    else {
        if (transColor) {
            replaceTransparentColor(indata, outdata, width, height, transColor);
        }

        if (depth !== 8 && !skipRescale) {
            if (depth === 16) outdata = Buffer.alloc(width * height * 4);

            scaleDepth(indata, outdata, width, height, depth);
        }
    }

    return outdata;
}

let pixelBppMapper = [
    function zero() {},

    function one(pxData, data, pxPos, rawPos) {
        if (rawPos === data.length) throw new Error('Ran out of data');

        let pixel = data[rawPos];

        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = 0xff;
    },

    function two(pxData, data, pxPos, rawPos) {
        if (rawPos + 1 >= data.length) throw new Error('Ran out of data');

        let pixel = data[rawPos];

        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = data[rawPos + 1];
    },

    function three(pxData, data, pxPos, rawPos) {
        if (rawPos + 2 >= data.length) throw new Error('Ran out of data');

        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = 0xff;
    },

    function four(pxData, data, pxPos, rawPos) {
        if (rawPos + 3 >= data.length) throw new Error('Ran out of data');

        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = data[rawPos + 3];
    },
];

let pixelBppCustomMapper = [
    function zero() {},

    function one(pxData, pixelData, pxPos, maxBit) {
        let pixel = pixelData[0];

        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = maxBit;
    },

    function two(pxData, pixelData, pxPos) {
        let pixel = pixelData[0];

        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = pixelData[1];
    },

    function three(pxData, pixelData, pxPos, maxBit) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = maxBit;
    },

    function four(pxData, pixelData, pxPos) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = pixelData[3];
    },
];

function bitRetriever(data, depth) {
    let leftOver = [];
    let i = 0;

    function split() {
        if (i === data.length) throw new Error('Ran out of data');

        let byte = data[i];

        i++;

        let byte8 = 0;
        let byte7 = 0;
        let byte6 = 0;
        let byte5 = 0;
        let byte4 = 0;
        let byte3 = 0;
        let byte2 = 0;
        let byte1 = 0;

        switch (depth) {
        default:
            throw new Error('unrecognised depth');
        case 16:
            byte2 = data[i];
            i++;
            leftOver.push((byte << 8) + byte2);
            break;
        case 4:
            byte2 = byte & 0x0f;
            byte1 = byte >> 4;
            leftOver.push(byte1, byte2);
            break;
        case 2:
            byte4 = byte & 3;
            byte3 = byte >> 2 & 3;
            byte2 = byte >> 4 & 3;
            byte1 = byte >> 6 & 3;
            leftOver.push(byte1, byte2, byte3, byte4);
            break;
        case 1:
            byte8 = byte & 1;
            byte7 = byte >> 1 & 1;
            byte6 = byte >> 2 & 1;
            byte5 = byte >> 3 & 1;
            byte4 = byte >> 4 & 1;
            byte3 = byte >> 5 & 1;
            byte2 = byte >> 6 & 1;
            byte1 = byte >> 7 & 1;
            leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
            break;
        }
    }

    return {
        get (count) {
            while (leftOver.length < count) {
                split();
            }

            let returner = leftOver.slice(0, count);

            leftOver = leftOver.slice(count);

            return returner;
        },

        resetAfterLine() {
            leftOver.length = 0;
        },

        end() {
            if (i !== data.length) {
                throw new Error('extra data found');
            }
        },
    };
}

function mapImage8Bit(image, pxData, getPxPos, bpp, data, position) {
    let rawPos = position;
    let imageWidth = image.width;
    let imageHeight = image.height;
    let imagePass = image.index;

    for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
            let pxPos = getPxPos(x, y, imagePass);

            pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
            rawPos += bpp;
        }
    }

    return rawPos;
}

function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
    let imageWidth = image.width;
    let imageHeight = image.height;
    let imagePass = image.index;

    for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
            let pixelData = bits.get(bpp);
            let pxPos = getPxPos(x, y, imagePass);

            pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
        }
        bits.resetAfterLine();
    }
}

function bitmapper(data, bitmapInfo) {
    let width = bitmapInfo.width;
    let height = bitmapInfo.height;
    let depth = bitmapInfo.depth;
    let bpp = bitmapInfo.bpp;
    let interlace = bitmapInfo.interlace;
    let bits = null;

    if (depth !== 8) bits = bitRetriever(data, depth);

    let pxData = null;

    if (depth <= 8) pxData = Buffer.alloc(width * height * 4);
    else pxData = new Uint16Array(width * height * 4);

    let maxBit = Math.pow(2, depth) - 1;
    let rawPos = 0;
    let images = null;
    let getPxPos = 0;

    if (interlace) {
        images = interlaceUtils.getImagePasses(width, height);
        getPxPos = interlaceUtils.getInterlaceIterator(width, height);
    } else {
        let nonInterlacedPxPos = 0;
        getPxPos = function getPosition() {
            let returner = nonInterlacedPxPos;
            nonInterlacedPxPos += 4;
            return returner;
        };
        images = [{ width, height }];
    }

    for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        if (depth === 8) {
            rawPos = mapImage8Bit(images[imageIndex], pxData, getPxPos, bpp, data, rawPos);
        } else {
            mapImageCustomBit(images[imageIndex], pxData, getPxPos, bpp, bits, maxBit);
        }
    }

    if (depth === 8) {
        if (rawPos !== data.length) throw new Error('extra data found');
    } else bits.end();

    return pxData;
}

function parse(buffer, options) {
    let err = null;

    function handleError(_err_) {
        err = _err_;
    }

    let metaData = null;

    function handleMetaData(_metaData_) {
        metaData = _metaData_;
    }

    function handleTransColor(transColor) {
        metaData.transColor = transColor;
    }

    function handlePalette(palette) {
        metaData.palette = palette;
    }

    function handleSimpleTransparency() {
        metaData.alpha = true;
    }

    let gamma = null;

    function handleGamma(_gamma_) {
        gamma = _gamma_;
    }

    let inflateDataList = [];

    function handleInflateData(inflatedData) {
        inflateDataList.push(inflatedData);
    }

    let reader = new SyncReader(buffer);

    let parser = new Parser(options, {
        read: reader.read.bind(reader),
        error: handleError,
        metadata: handleMetaData,
        gamma: handleGamma,
        palette: handlePalette,
        transColor: handleTransColor,
        inflateData: handleInflateData,
        simpleTransparency: handleSimpleTransparency,
    });

    parser.start();
    reader.process();

    if (err) throw err;

    let inflateData = Buffer.concat(inflateDataList);

    inflateDataList.length = 0;

    let inflatedData = null;

    if (metaData.interlace) inflatedData = zlib.inflateSync(inflateData);
    else {
        let rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
        let imageSize = rowSize * metaData.height;

        inflatedData = inflateSync(inflateData, {
            chunkSize: imageSize,
            maxLength: imageSize,
        });
    }

    inflateData = null;

    if (!inflatedData || !inflatedData.length) throw new Error('bad png - invalid inflate data response');

    let unfilteredData = FilterSync(inflatedData, metaData);

    inflateData = null;

    let bitmapData = bitmapper(unfilteredData, metaData);

    unfilteredData = null;

    let normalisedBitmapData = formatNormaliser(
        bitmapData,
        metaData,
        options.skipRescale
    );

    metaData.data = normalisedBitmapData;
    metaData.gamma = gamma || 0;
    metaData.format = 'png';

    return metaData;
}

exports.decodePNG = function decode(buffer, options) {
    return parse(buffer, options || {});
};

exports.encodePNG = function encode(png, options) {
    return {
        width: png.width,
        height: png.height,
        data: pack(png, options),
        format: 'png',
    };
};
