class TIFF {
    static decode(buff, prm) {
        const newPrm = !prm ? {
            parseMN: true,
            debug: false
        } : prm;

        let data = new Uint8Array(buff);
        let offset = 0;
        let id = TIFF.binBE.readASCII(data, offset, 2);
        offset += 2;
        let bin = id === 'II' ? TIFF.binLE : TIFF.binBE;
        offset += 2;
        let ifdo = bin.readUint(data, offset);
        offset += 4;
        let ifds = [];

        while (true) {
            const typ = bin.readUshort(data, ifdo + 4);
            const cnt = bin.readUshort(data, ifdo);

            if (cnt !== 0 && typ < 1 || typ > 13) break;

            TIFF.readIFD(bin, data, ifdo, ifds, 0, newPrm);
            ifdo = bin.readUint(data, ifdo + 2 + cnt * 12);

            if (ifdo === 0) break;
        }

        return ifds;
    }

    static decodeImage(buff, img, ifds) {
        if (img.data) return;

        let data = new Uint8Array(buff);
        let id = TIFF.binBE.readASCII(data, 0, 2);

        if (!img.t256) return;

        img.isLE = id === 'II';
        img.width = img.t256[0];
        img.height = img.t257[0];

        let cmpr = img.t259 ? img.t259[0] : 1;
        let fo = img.t266 ? img.t266[0] : 1;
        if (cmpr === 7 && img.t258 && img.t258.length > 3) img.t258 = img.t258.slice(0, 3);

        let spp = img.t277 ? img.t277[0] : 1;
        let bps = img.t258 ? img.t258[0] : 1;
        let bipp = bps * spp;

        if (cmpr === 1 && img.t279 && img.t278 && img.t262[0] === 32803) {
            bipp = Math.round(img.t279[0] * 8 / (img.width * img.t278[0]));
        }

        if (img.t50885 && img.t50885[0] === 4) bipp = img.t258[0] * 3;

        let bipl = Math.ceil(img.width * bipp / 8) * 8;
        let soff = img.t273;
        if (!soff || img.t322) soff = img.t324;
        let bcnt = img.t279;
        if (cmpr === 1 && soff.length === 1) bcnt = [img.height * (bipl >>> 3)];
        if (!bcnt || img.t322) bcnt = img.t325;

        let bytes = new Uint8Array(img.height * (bipl >>> 3)),
            bilen = 0;

        if (img.t322) {
            let tw = img.t322[0],
                th = img.t323[0];
            let tx = Math.floor((img.width + tw - 1) / tw);
            let ty = Math.floor((img.height + th - 1) / th);
            let tbuff = new Uint8Array(Math.ceil(tw * th * bipp / 8) | 0);
            for (let y = 0; y < ty; y++)
                for (let x = 0; x < tx; x++) {
                    let i = y * tx + x;
                    tbuff.fill(0);
                    TIFF.decode.decompress(img, ifds, data, soff[i], bcnt[i], cmpr, tbuff, 0, fo, tw, th);

                    if (cmpr === 6) bytes = tbuff;
                    else TIFF.copyTile(tbuff, Math.ceil(tw * bipp / 8) | 0, th, bytes, Math.ceil(img.width * bipp / 8) | 0, img.height, Math.ceil(x * tw * bipp / 8) | 0, y * th);
                }
            bilen = bytes.length * 8;
        } else {
            if (!soff) return;
            let rps = img.t278 ? img.t278[0] : img.height;
            rps = Math.min(rps, img.height);

            for (let i = 0; i < soff.length; i++) {
                TIFF.decode.decompress(img, ifds, data, soff[i], bcnt[i], cmpr, bytes, Math.ceil(bilen / 8) | 0, fo, img.width, rps);
                bilen += bipl * rps;
            }
            bilen = Math.min(bilen, bytes.length * 8);
        }
        img.data = new Uint8Array(bytes.buffer, 0, Math.ceil(bilen / 8) | 0);
    }

    static encode(ifds) {
        let LE = false;
        let data = new Uint8Array(20000), offset = 4, bin = LE ? TIFF.binLE : TIFF.binBE;
        data[0] = data[1] = LE ? 73 : 77; bin.writeUshort(data, 2, 42);

        let ifdo = 8;
        bin.writeUint(data, offset, ifdo); offset += 4;
        for (let i = 0; i < ifds.length; i++) {
            let noffs = TIFF.writeIFD(bin, TIFF.types.basic, data, ifdo, ifds[i]);
            ifdo = noffs[1];
            if (i < ifds.length - 1) {
                if ((ifdo & 3) !== 0) ifdo += 4 - (ifdo & 3);
                bin.writeUint(data, noffs[0], ifdo);
            }
        }
        return data.slice(0, ifdo).buffer;
    }

    static encodeImage(rgba, w, h, metadata) {
        let idf = {
            't256': [w],
            't257': [h],
            't258': [8, 8, 8, 8],
            't259': [1],
            't262': [2],
            't273': [1000],
            't277': [4],
            't278': [h],
            't279': [w * h * 4],
            't282': [
                [72, 1]
            ],
            't283': [
                [72, 1]
            ],
            't284': [1],
            't286': [
                [0, 1]
            ],
            't287': [
                [0, 1]
            ],
            't296': [1],
            't305': ['TiffEncoder'],
            't338': [1]
        };

        if (metadata) {
            for (let i in metadata) {
                if (Object.prototype.hasOwnProperty.call(metadata, i)) {
                    idf[i] = metadata[i];
                }
            }
        }

        let prfx = new Uint8Array(TIFF.encode([idf]));
        let img = new Uint8Array(rgba);
        let data = new Uint8Array(1000 + w * h * 4);
        for (let i = 0; i < prfx.length; i++) data[i] = prfx[i];
        for (let i = 0; i < img.length; i++) data[1000 + i] = img[i];
        return data.buffer;
    }
}

TIFF.decode.decompress = function decodeDecompress(img, ifds, data, off, len, oldCmpr, tgt, toff, fo, w, h) {
    const cmpr = img.t271 && img.t271[0] === 'Panasonic' && img.t45 && img.t45[0] === 6 ? 34316 : oldCmpr;

    if (cmpr === 1) for (let j = 0; j < len; j++) tgt[toff + j] = data[off + j];
    else if (cmpr === 2) TIFF.decode.decodeG2(data, off, len, tgt, toff, w, fo);
    else if (cmpr === 3) TIFF.decode.decodeG3(data, off, len, tgt, toff, w, fo, img.t292 ? (img.t292[0] & 1) === 1 : false);
    else if (cmpr === 4) TIFF.decode.decodeG4(data, off, len, tgt, toff, w, fo);
    else if (cmpr === 5) TIFF.decode.decodeLZW(data, off, len, tgt, toff, 8);
    else if (cmpr === 6) TIFF.decode.decodeOldJPEG(img, data, off, len, tgt, toff);
    else if (cmpr === 7 || cmpr === 34892) TIFF.decode.decodeNewJPEG(img, data, off, len, tgt, toff);
    else if (cmpr === 8 || cmpr === 32946) throw new Error('TIFF image format is not supported.');
    else if (cmpr === 9) TIFF.decode.decodeVC5(data, off, len, tgt, toff, img.t33422);
    else if (cmpr === 32767) TIFF.decode.decodeARW(img, data, off, len, tgt, toff);
    else if (cmpr === 32773) TIFF.decode.decodePackBits(data, off, len, tgt, toff);
    else if (cmpr === 32809) TIFF.decode.decodeThunder(data, off, len, tgt, toff);
    else if (cmpr === 34316) TIFF.decode.decodePanasonic(img, data, off, len, tgt);
    else if (cmpr === 34713) TIFF.decode.decodeNikon(img, ifds, data, off, len, tgt);
    else if (cmpr === 34676) TIFF.decode.decodeLogLuv32(img, data, off, len, tgt, toff);

    let bps = img.t258 ? Math.min(32, img.t258[0]) : 1;
    let noc = img.t277 ? img.t277[0] : 1,
        bpp = bps * noc >>> 3,
        bpl = Math.ceil(bps * noc * w / 8);

    if (img.t317 && img.t317[0] === 2) {
        for (let y = 0; y < h; y++) {
            let ntoff = toff + y * bpl;
            if (bps === 16)
                for (let j = bpp; j < bpl; j += 2) {
                    let nv = (tgt[ntoff + j + 1] << 8 | tgt[ntoff + j]) + (tgt[ntoff + j - bpp + 1] << 8 | tgt[ntoff + j - bpp]);
                    tgt[ntoff + j] = nv & 255;
                    tgt[ntoff + j + 1] = nv >>> 8 & 255;
                }
            else if (noc === 3)
                for (let j = 3; j < bpl; j += 3) {
                    tgt[ntoff + j] = tgt[ntoff + j] + tgt[ntoff + j - 3] & 255;
                    tgt[ntoff + j + 1] = tgt[ntoff + j + 1] + tgt[ntoff + j - 2] & 255;
                    tgt[ntoff + j + 2] = tgt[ntoff + j + 2] + tgt[ntoff + j - 1] & 255;
                }
            else {
                for (let j = bpp; j < bpl; j++) {
                    tgt[ntoff + j] = tgt[ntoff + j] + tgt[ntoff + j - bpp] & 255;
                }
            }
        }
    }
};

TIFF.decode.decodePanasonic = function decodeDecodePanasonic(img, data, off, len, tgt) {
    let imgBuffer = data.buffer;

    let rawWidth = img.t2[0];
    let rawHeight = img.t3[0];
    let bitsPerSample = img.t10[0];
    let RW2Format = img.t45[0];

    let bidx = 0;
    let imageIndex = 0;
    let vpos = 0;
    let byte = 0;
    let bytes = RW2Format === 6 ? new Uint32Array(18) : new Uint8Array(16);
    let i = 0, j = 0, sh = 0, pred = [0, 0],
        nonz = [0, 0],
        isOdd = 0, idx = 0,
        pixelBase = 0;

    let buffer = new Uint8Array(0x4000);
    let result = new Uint16Array(tgt.buffer);

    function getDataRaw(bits) {
        if (vpos === 0) {
            let arrA = new Uint8Array(imgBuffer, off + imageIndex + 0x1ff8, 0x4000 - 0x1ff8);
            let arrB = new Uint8Array(imgBuffer, off + imageIndex, 0x1ff8);
            buffer.set(arrA);
            buffer.set(arrB, arrA.length);
            imageIndex += 0x4000;
        }
        if (RW2Format === 5) {
            for (i = 0; i < 16; i++) {
                bytes[i] = buffer[vpos++];
                vpos &= 0x3FFF;
            }
        } else {
            vpos = vpos - bits & 0x1ffff;
            byte = vpos >> 3 ^ 0x3ff0;
            return (buffer[byte] | buffer[byte + 1] << 8) >> (vpos & 7) & ~(-1 << bits);
        }
    }

    function getBufferDataRW6(newI) {
        return buffer[vpos + 15 - newI];
    }

    function readPageRW6() {
        bytes[0] = getBufferDataRW6(0) << 6 | getBufferDataRW6(1) >> 2;
        bytes[1] = ((getBufferDataRW6(1) & 0x3) << 12 | getBufferDataRW6(2) << 4 | getBufferDataRW6(3) >> 4) & 0x3fff;
        bytes[2] = getBufferDataRW6(3) >> 2 & 0x3;
        bytes[3] = (getBufferDataRW6(3) & 0x3) << 8 | getBufferDataRW6(4);
        bytes[4] = getBufferDataRW6(5) << 2 | getBufferDataRW6(6) >> 6;
        bytes[5] = (getBufferDataRW6(6) & 0x3f) << 4 | getBufferDataRW6(7) >> 4;
        bytes[6] = getBufferDataRW6(7) >> 2 & 0x3;
        bytes[7] = (getBufferDataRW6(7) & 0x3) << 8 | getBufferDataRW6(8);
        bytes[8] = getBufferDataRW6(9) << 2 & 0x3fc | getBufferDataRW6(10) >> 6;
        bytes[9] = (getBufferDataRW6(10) << 4 | getBufferDataRW6(11) >> 4) & 0x3ff;
        bytes[10] = getBufferDataRW6(11) >> 2 & 0x3;
        bytes[11] = (getBufferDataRW6(11) & 0x3) << 8 | getBufferDataRW6(12);
        bytes[12] = (getBufferDataRW6(13) << 2 & 0x3fc | getBufferDataRW6(14) >> 6) & 0x3ff;
        bytes[13] = (getBufferDataRW6(14) << 4 | getBufferDataRW6(15) >> 4) & 0x3ff;
        vpos += 16;
        byte = 0;
    }

    function readPageRw6BPS12() {
        bytes[0] = getBufferDataRW6(0) << 4 | getBufferDataRW6(1) >> 4;
        bytes[1] = ((getBufferDataRW6(1) & 0xf) << 8 | getBufferDataRW6(2)) & 0xfff;
        bytes[2] = getBufferDataRW6(3) >> 6 & 0x3;
        bytes[3] = (getBufferDataRW6(3) & 0x3f) << 2 | getBufferDataRW6(4) >> 6;
        bytes[4] = (getBufferDataRW6(4) & 0x3f) << 2 | getBufferDataRW6(5) >> 6;
        bytes[5] = (getBufferDataRW6(5) & 0x3f) << 2 | getBufferDataRW6(6) >> 6;
        bytes[6] = getBufferDataRW6(6) >> 4 & 0x3;
        bytes[7] = (getBufferDataRW6(6) & 0xf) << 4 | getBufferDataRW6(7) >> 4;
        bytes[8] = (getBufferDataRW6(7) & 0xf) << 4 | getBufferDataRW6(8) >> 4;
        bytes[9] = (getBufferDataRW6(8) & 0xf) << 4 | getBufferDataRW6(9) >> 4;
        bytes[10] = getBufferDataRW6(9) >> 2 & 0x3;
        bytes[11] = (getBufferDataRW6(9) & 0x3) << 6 | getBufferDataRW6(10) >> 2;
        bytes[12] = (getBufferDataRW6(10) & 0x3) << 6 | getBufferDataRW6(11) >> 2;
        bytes[13] = (getBufferDataRW6(11) & 0x3) << 6 | getBufferDataRW6(12) >> 2;
        bytes[14] = getBufferDataRW6(12) & 0x3;
        bytes[15] = getBufferDataRW6(13);
        bytes[16] = getBufferDataRW6(14);
        bytes[17] = getBufferDataRW6(15);

        vpos += 16;
        byte = 0;
    }

    function resetPredNonzeros() {
        pred[0] = 0;
        pred[1] = 0;
        nonz[0] = 0;
        nonz[1] = 0;
    }
    if (RW2Format === 7) {
        throw RW2Format;
    } else if (RW2Format === 6) {
        let is12bit = bitsPerSample === 12,
            readPageRw6Fn = is12bit ? readPageRw6BPS12 : readPageRW6,
            pixelsPerBlock = is12bit ? 14 : 11,
            pixelbase0 = is12bit ? 0x80 : 0x200,
            pixelBaseCompare = is12bit ? 0x800 : 0x2000,
            spixCompare = is12bit ? 0x3fff : 0xffff,
            pixelMask = is12bit ? 0xfff : 0x3fff,
            blocksperrow = rawWidth / pixelsPerBlock,
            rowbytes = blocksperrow * 16,
            bufferSize = is12bit ? 18 : 14;

        for (let row = 0; row < rawHeight - 15; row += 16) {
            let rowstoread = Math.min(16, rawHeight - row);
            let readlen = rowbytes * rowstoread;
            buffer = new Uint8Array(imgBuffer, off + bidx, readlen);
            vpos = 0;
            bidx += readlen;
            for (let crow = 0, col = 0; crow < rowstoread; crow++, col = 0) {
                idx = (row + crow) * rawWidth;
                for (let rblock = 0; rblock < blocksperrow; rblock++) {
                    readPageRw6Fn();
                    resetPredNonzeros();
                    sh = 0;
                    pixelBase = 0;
                    for (i = 0; i < pixelsPerBlock; i++) {
                        isOdd = i & 1;
                        if (i % 3 === 2) {
                            let base = byte < bufferSize ? bytes[byte++] : 0;
                            if (base === 3) base = 4;
                            pixelBase = pixelbase0 << base;
                            sh = 1 << base;
                        }
                        let epixel = byte < bufferSize ? bytes[byte++] : 0;
                        if (pred[isOdd]) {
                            epixel *= sh;
                            if (pixelBase < pixelBaseCompare && nonz[isOdd] > pixelBase)
                                epixel += nonz[isOdd] - pixelBase;
                            nonz[isOdd] = epixel;
                        } else {
                            pred[isOdd] = epixel;
                            if (epixel)
                                nonz[isOdd] = epixel;
                            else
                                epixel = nonz[isOdd];
                        }
                        result[idx + col++] = epixel - 0xf <= spixCompare ? epixel - 0xf & spixCompare : epixel + 0x7ffffff1 >> 0x1f & pixelMask;
                    }
                }
            }
        }
    } else if (RW2Format === 5) {
        let blockSize = bitsPerSample === 12 ? 10 : 9;
        for (let row = 0; row < rawHeight; row++) {
            for (let col = 0; col < rawWidth; col += blockSize) {
                getDataRaw(0);

                if (bitsPerSample === 12) {
                    result[idx++] = ((bytes[1] & 0xF) << 8) + bytes[0];
                    result[idx++] = 16 * bytes[2] + (bytes[1] >> 4);
                    result[idx++] = ((bytes[4] & 0xF) << 8) + bytes[3];
                    result[idx++] = 16 * bytes[5] + (bytes[4] >> 4);
                    result[idx++] = ((bytes[7] & 0xF) << 8) + bytes[6];
                    result[idx++] = 16 * bytes[8] + (bytes[7] >> 4);
                    result[idx++] = ((bytes[10] & 0xF) << 8) + bytes[9];
                    result[idx++] = 16 * bytes[11] + (bytes[10] >> 4);
                    result[idx++] = ((bytes[13] & 0xF) << 8) + bytes[12];
                    result[idx++] = 16 * bytes[14] + (bytes[13] >> 4);
                } else if (bitsPerSample === 14) {
                    result[idx++] = bytes[0] + ((bytes[1] & 0x3F) << 8);
                    result[idx++] = (bytes[1] >> 6) + 4 * bytes[2] + ((bytes[3] & 0xF) << 10);
                    result[idx++] = (bytes[3] >> 4) + 16 * bytes[4] + ((bytes[5] & 3) << 12);
                    result[idx++] = ((bytes[5] & 0xFC) >> 2) + (bytes[6] << 6);
                    result[idx++] = bytes[7] + ((bytes[8] & 0x3F) << 8);
                    result[idx++] = (bytes[8] >> 6) + 4 * bytes[9] + ((bytes[10] & 0xF) << 10);
                    result[idx++] = (bytes[10] >> 4) + 16 * bytes[11] + ((bytes[12] & 3) << 12);
                    result[idx++] = ((bytes[12] & 0xFC) >> 2) + (bytes[13] << 6);
                    result[idx++] = bytes[14] + ((bytes[15] & 0x3F) << 8);
                }
            }
        }
    } else if (RW2Format === 4) {
        for (let row = 0; row < rawHeight; row++) {
            for (let col = 0; col < rawWidth; col++) {
                i = col % 14;
                isOdd = i & 1;
                if (i === 0) resetPredNonzeros();
                if (i % 3 === 2)
                    sh = 4 >> 3 - getDataRaw(2);
                if (nonz[isOdd]) {
                    j = getDataRaw(8);
                    if (j !== 0) {
                        pred[isOdd] -= 0x80 << sh;
                        if (pred[isOdd] < 0 || sh === 4)
                            pred[isOdd] &= ~(-1 << sh);
                        pred[isOdd] += j << sh;
                    }
                } else {
                    nonz[isOdd] = getDataRaw(8);
                    if (nonz[isOdd] || i > 11)
                        pred[isOdd] = nonz[isOdd] << 4 | getDataRaw(4);
                }
                result[idx++] = pred[col & 1];
            }
        }
    } else throw RW2Format;
};

TIFF.decode.decodeVC5 = (function decodeDecodeVC5() {
    let x = [1, 0, 1, 0, 2, 2, 1, 1, 3, 7, 1, 2, 5, 25, 1, 3, 6, 48, 1, 4, 6, 54, 1, 5, 7, 111, 1, 8, 7, 99, 1, 6, 7, 105, 12, 0, 7, 107, 1, 7, 8, 209, 20, 0, 8, 212, 1, 9, 8, 220, 1, 10, 9, 393, 1, 11, 9, 394, 32, 0, 9, 416, 1, 12, 9, 427, 1, 13, 10, 887, 1, 18, 10, 784, 1, 14, 10, 790, 1, 15, 10, 835, 60, 0, 10, 852, 1, 16, 10, 885, 1, 17, 11, 1571, 1, 19, 11, 1668, 1, 20, 11, 1669, 100, 0, 11, 1707, 1, 21, 11, 1772, 1, 22, 12, 3547, 1, 29, 12, 3164, 1, 24, 12, 3166, 1, 25, 12, 3140, 1, 23, 12, 3413, 1, 26, 12, 3537, 1, 27, 12, 3539, 1, 28, 13, 7093, 1, 35, 13, 6283, 1, 30, 13, 6331, 1, 31, 13, 6335, 180, 0, 13, 6824, 1, 32, 13, 7072, 1, 33, 13, 7077, 320, 0, 13, 7076, 1, 34, 14, 12565, 1, 36, 14, 12661, 1, 37, 14, 12669, 1, 38, 14, 13651, 1, 39, 14, 14184, 1, 40, 15, 28295, 1, 46, 15, 28371, 1, 47, 15, 25320, 1, 42, 15, 25336, 1, 43, 15, 25128, 1, 41, 15, 27300, 1, 44, 15, 28293, 1, 45, 16, 50259, 1, 48, 16, 50643, 1, 49, 16, 50675, 1, 50, 16, 56740, 1, 53, 16, 56584, 1, 51, 16, 56588, 1, 52, 17, 113483, 1, 61, 17, 113482, 1, 60, 17, 101285, 1, 55, 17, 101349, 1, 56, 17, 109205, 1, 57, 17, 109207, 1, 58, 17, 100516, 1, 54, 17, 113171, 1, 59, 18, 202568, 1, 62, 18, 202696, 1, 63, 18, 218408, 1, 64, 18, 218412, 1, 65, 18, 226340, 1, 66, 18, 226356, 1, 67, 18, 226358, 1, 68, 19, 402068, 1, 69, 19, 405138, 1, 70, 19, 405394, 1, 71, 19, 436818, 1, 72, 19, 436826, 1, 73, 19, 452714, 1, 75, 19, 452718, 1, 76, 19, 452682, 1, 74, 20, 804138, 1, 77, 20, 810279, 1, 78, 20, 810790, 1, 79, 20, 873638, 1, 80, 20, 873654, 1, 81, 20, 905366, 1, 82, 20, 905430, 1, 83, 20, 905438, 1, 84, 21, 1608278, 1, 85, 21, 1620557, 1, 86, 21, 1621582, 1, 87, 21, 1621583, 1, 88, 21, 1747310, 1, 89, 21, 1810734, 1, 90, 21, 1810735, 1, 91, 21, 1810863, 1, 92, 21, 1810879, 1, 93, 22, 3621725, 1, 99, 22, 3621757, 1, 100, 22, 3241112, 1, 94, 22, 3494556, 1, 95, 22, 3494557, 1, 96, 22, 3494622, 1, 97, 22, 3494623, 1, 98, 23, 6482227, 1, 102, 23, 6433117, 1, 101, 23, 6989117, 1, 103, 23, 6989119, 1, 105, 23, 6989118, 1, 104, 23, 7243449, 1, 106, 23, 7243512, 1, 107, 24, 13978233, 1, 111, 24, 12964453, 1, 109, 24, 12866232, 1, 108, 24, 14486897, 1, 113, 24, 13978232, 1, 110, 24, 14486896, 1, 112, 24, 14487026, 1, 114, 24, 14487027, 1, 115, 25, 25732598, 1, 225, 25, 25732597, 1, 189, 25, 25732596, 1, 188, 25, 25732595, 1, 203, 25, 25732594, 1, 202, 25, 25732593, 1, 197, 25, 25732592, 1, 207, 25, 25732591, 1, 169, 25, 25732590, 1, 223, 25, 25732589, 1, 159, 25, 25732522, 1, 235, 25, 25732579, 1, 152, 25, 25732575, 1, 192, 25, 25732489, 1, 179, 25, 25732573, 1, 201, 25, 25732472, 1, 172, 25, 25732576, 1, 149, 25, 25732488, 1, 178, 25, 25732566, 1, 120, 25, 25732571, 1, 219, 25, 25732577, 1, 150, 25, 25732487, 1, 127, 25, 25732506, 1, 211, 25, 25732548, 1, 125, 25, 25732588, 1, 158, 25, 25732486, 1, 247, 25, 25732467, 1, 238, 25, 25732508, 1, 163, 25, 25732552, 1, 228, 25, 25732603, 1, 183, 25, 25732513, 1, 217, 25, 25732587, 1, 168, 25, 25732520, 1, 122, 25, 25732484, 1, 128, 25, 25732562, 1, 249, 25, 25732505, 1, 187, 25, 25732504, 1, 186, 25, 25732483, 1, 136, 25, 25928905, 1, 181, 25, 25732560, 1, 255, 25, 25732500, 1, 230, 25, 25732482, 1, 135, 25, 25732555, 1, 233, 25, 25732568, 1, 222, 25, 25732583, 1, 145, 25, 25732481, 1, 134, 25, 25732586, 1, 167, 25, 25732521, 1, 248, 25, 25732518, 1, 209, 25, 25732480, 1, 243, 25, 25732512, 1, 216, 25, 25732509, 1, 164, 25, 25732547, 1, 140, 25, 25732479, 1, 157, 25, 25732544, 1, 239, 25, 25732574, 1, 191, 25, 25732564, 1, 251, 25, 25732478, 1, 156, 25, 25732546, 1, 139, 25, 25732498, 1, 242, 25, 25732557, 1, 133, 25, 25732477, 1, 162, 25, 25732515, 1, 213, 25, 25732584, 1, 165, 25, 25732514, 1, 212, 25, 25732476, 1, 227, 25, 25732494, 1, 198, 25, 25732531, 1, 236, 25, 25732530, 1, 234, 25, 25732529, 1, 117, 25, 25732528, 1, 215, 25, 25732527, 1, 124, 25, 25732526, 1, 123, 25, 25732525, 1, 254, 25, 25732524, 1, 253, 25, 25732523, 1, 148, 25, 25732570, 1, 218, 25, 25732580, 1, 146, 25, 25732581, 1, 147, 25, 25732569, 1, 224, 25, 25732533, 1, 143, 25, 25732540, 1, 184, 25, 25732541, 1, 185, 25, 25732585, 1, 166, 25, 25732556, 1, 132, 25, 25732485, 1, 129, 25, 25732563, 1, 250, 25, 25732578, 1, 151, 25, 25732501, 1, 119, 25, 25732502, 1, 193, 25, 25732536, 1, 176, 25, 25732496, 1, 245, 25, 25732553, 1, 229, 25, 25732516, 1, 206, 25, 25732582, 1, 144, 25, 25732517, 1, 208, 25, 25732558, 1, 137, 25, 25732543, 1, 241, 25, 25732466, 1, 237, 25, 25732507, 1, 190, 25, 25732542, 1, 240, 25, 25732551, 1, 131, 25, 25732554, 1, 232, 25, 25732565, 1, 252, 25, 25732475, 1, 171, 25, 25732493, 1, 205, 25, 25732492, 1, 204, 25, 25732491, 1, 118, 25, 25732490, 1, 214, 25, 25928904, 1, 180, 25, 25732549, 1, 126, 25, 25732602, 1, 182, 25, 25732539, 1, 175, 25, 25732545, 1, 141, 25, 25732559, 1, 138, 25, 25732537, 1, 177, 25, 25732534, 1, 153, 25, 25732503, 1, 194, 25, 25732606, 1, 160, 25, 25732567, 1, 121, 25, 25732538, 1, 174, 25, 25732497, 1, 246, 25, 25732550, 1, 130, 25, 25732572, 1, 200, 25, 25732474, 1, 170, 25, 25732511, 1, 221, 25, 25732601, 1, 196, 25, 25732532, 1, 142, 25, 25732519, 1, 210, 25, 25732495, 1, 199, 25, 25732605, 1, 155, 25, 25732535, 1, 154, 25, 25732499, 1, 244, 25, 25732510, 1, 220, 25, 25732600, 1, 195, 25, 25732607, 1, 161, 25, 25732604, 1, 231, 25, 25732473, 1, 173, 25, 25732599, 1, 226, 26, 51465122, 1, 116, 26, 51465123, 0, 1],
        o = null, C = null, k = null, P = [3, 3, 3, 3, 2, 2, 2, 1, 1, 1],
        V = 24576,
        ar = 16384,
        H = 8192,
        az = ar | H;

    function d(oldT) {
        let t = oldT;
        let E = t[1];
        let h = t[0][E >>> 3] >>> 7 - (E & 7) & 1;

        t[1]++;

        return h;
    }

    function ag(t, E) {
        if (!o) {
            o = {};
            for (let h = 0; h < x.length; h += 4) o[x[h + 1]] = x.slice(h, h + 4);
        }

        let L = d(t),
            g = o[L];
        while (!g) {
            L = L << 1 | d(t);
            g = o[L];
        }
        let n = g[3];
        if (n !== 0) n = d(t) === 0 ? n : -n;
        E[0] = g[2];
        E[1] = n;
    }

    function m(oldT, E) {
        let t = oldT;

        for (let h = 0; h < E; h++) {
            if ((t & 1) === 1) t++;
            t = t >>> 1;
        }

        return t;
    }

    function A(t, E) {
        return t >> E;
    }

    function O(t, E, h, L, g, n) {
        E[h] = A(A(11 * t[g] - 4 * t[g + n] + t[g + n + n] + 4, 3) + t[L], 1);
        E[h + n] = A(A(5 * t[g] + 4 * t[g + n] - t[g + n + n] + 4, 3) - t[L], 1);
    }

    function J(t, E, h, L, g, n) {
        let W = t[g - n] - t[g + n],
            j = t[g],
            $ = t[L];
        E[h] = A(A(W + 4, 3) + j + $, 1);
        E[h + n] = A(A(-W + 4, 3) + j - $, 1);
    }

    function y(t, E, h, L, g, n) {
        E[h] = A(A(5 * t[g] + 4 * t[g - n] - t[g - n - n] + 4, 3) + t[L], 1);
        E[h + n] = A(A(11 * t[g] - 4 * t[g - n] + t[g - n - n] + 4, 3) - t[L], 1);
    }

    function q(oldT) {
        let t = oldT;

        t = Math.max(0, Math.min(4095, t));
        t = k[t] >>> 2;

        return t;
    }

    function av(t, oldE, h, oldL, g, n) {
        let E = oldE;
        let L = new Uint16Array(oldL.buffer);
        let j = TIFF.binBE,
            $ = E + h,
            u = 0, X = 0, I = 0, ax = 0, R = 0, aa = 0, T = null, B = null;
        E += 4;
        let a5 = n[0] === 1;
        while (E < $) {
            let S = j.readShort(t, E),
                s = j.readUshort(t, E + 2);
            E += 4;

            if (S === 20) u = s;
            else if (S === 21) X = s;
            else if (S === 48) I = s;
            else if (S === 53) ax = s;
            else if (S === 62) R = s;
            else if (S === 109) aa = s;
            else {
                let F = S < 0 ? -S : S,
                    _ = 0;
                if (F & az) {
                    if (F & H) {
                        _ = s & 65535;
                        _ += (F & 255) << 16;
                    } else {
                        _ = s & 65535;
                    }
                }
                if ((F & V) === V) {
                    if (!T) {
                        T = [];
                        for (let M = 0; M < 4; M++) T[M] = new Int16Array((u >>> 1) * (X >>> 1));
                        B = new Int16Array((u >>> 1) * (X >>> 1));
                        C = new Int16Array(1024);
                        for (let M = 0; M < 1024; M++) {
                            let aG = M - 512,
                                p = Math.abs(aG),
                                r = Math.floor(768 * p * p * p / (255 * 255 * 255)) + p;
                            C[M] = Math.sign(aG) * r;
                        }
                        k = new Uint16Array(4096);
                        let aA = (1 << 16) - 1;
                        for (let M = 0; M < 4096; M++) {
                            let at = M,
                                a1 = aA * (Math.pow(113, at / 4095) - 1) / 112;
                            k[M] = Math.min(a1, aA);
                        }
                    }
                    let w = T[R],
                        v = m(u, 1 + P[I]),
                        N = m(X, 1 + P[I]);
                    if (I === 0) {
                        for (let b = 0; b < N; b++)
                            for (let G = 0; G < v; G++) {
                                let c = E + (b * v + G) * 2;
                                w[b * (u >>> 1) + G] = t[c] << 8 | t[c + 1];
                            }
                    } else {
                        let a7 = [t, E * 8],
                            a4 = [],
                            ay = 0,
                            aw = v * N,
                            f = [0, 0],
                            Q = 0;
                        s = 0;
                        while (ay < aw) {
                            ag(a7, f);
                            Q = f[0];
                            s = f[1];
                            while (Q > 0) {
                                a4[ay++] = s;
                                Q--;
                            }
                        }
                        let l = (I - 1) % 3,
                            aF = l !== 1 ? v : 0,
                            a2 = l !== 0 ? N : 0;
                        for (let b = 0; b < N; b++) {
                            let af = (b + a2) * (u >>> 1) + aF,
                                au = b * v;
                            for (let G = 0; G < v; G++) w[af + G] = C[a4[au + G] + 512] * ax;
                        }
                        if (l === 2) {
                            let i = u >>> 1,
                                an = v * 2,
                                a9 = N * 2;
                            for (let b = 0; b < N; b++) {
                                for (let G = 0; G < an; G++) {
                                    let M = b * 2 * i + G,
                                        a = b * i + G,
                                        e = N * i + a;
                                    if (b === 0) O(w, B, M, e, a, i);
                                    else if (b === N - 1) y(w, B, M, e, a, i);
                                    else J(w, B, M, e, a, i);
                                }
                            }
                            w = B;
                            for (let b = 0; b < a9; b++) {
                                for (let G = 0; G < v; G++) {
                                    let M = b * i + 2 * G,
                                        a = b * i + G,
                                        e = v + a;
                                    if (G === 0) O(w, B, M, e, a, 1);
                                    else if (G === v - 1) y(w, B, M, e, a, 1);
                                    else J(w, B, M, e, a, 1);
                                }
                            }
                            w = B;
                            let aC = [],
                                aB = 2 - ~~((I - 1) / 3);
                            for (let K = 0; K < 3; K++) aC[K] = aa >> 14 - K * 2 & 3;
                            let a6 = aC[aB];
                            if (a6 !== 0)
                                for (let b = 0; b < a9; b++)
                                    for (let G = 0; G < an; G++) {
                                        let M = b * i + G;
                                        w[M] = w[M] << a6;
                                    }
                        }
                    }
                    if (I === 9 && R === 3) {
                        let a8 = T[0],
                            ab = T[1],
                            aq = T[2],
                            as = T[3];
                        for (let b = 0; b < X; b += 2)
                            for (let G = 0; G < u; G += 2) {
                                let U = b * u + G,
                                    c = (b >>> 1) * (u >>> 1) + (G >>> 1),
                                    z = a8[c],
                                    ao = ab[c] - 2048,
                                    ak = aq[c] - 2048,
                                    ad = as[c] - 2048,
                                    aj = (ao << 1) + z,
                                    a0 = (ak << 1) + z,
                                    aH = z + ad,
                                    am = z - ad;
                                if (a5) {
                                    L[U] = q(aH);
                                    L[U + 1] = q(a0);
                                    L[U + u] = q(aj);
                                    L[U + u + 1] = q(am);
                                } else {
                                    L[U] = q(aj);
                                    L[U + 1] = q(aH);
                                    L[U + u] = q(am);
                                    L[U + u + 1] = q(a0);
                                }
                            }
                    }
                    E += _ * 4;
                } else if (F === 16388) {
                    E += _ * 4;
                } else throw F.toString(16);
            }
        }
    }
    return av;
}());

TIFF.decode.decodeLogLuv32 = function decodeDecodeLogLuv32(img, data, off, len, tgt, oldToff) {
    let toff = oldToff;
    let w = img.width,
        qw = w * 4;
    let io = 0,
        out = new Uint8Array(qw);

    while (io < len) {
        let oo = 0;
        while (oo < qw) {
            let c = data[off + io];
            io++;
            if (c < 128) {
                for (let j = 0; j < c; j++) out[oo + j] = data[off + io + j];
                oo += c;
                io += c;
            } else {
                c = c - 126;
                for (let j = 0; j < c; j++) out[oo + j] = data[off + io];
                oo += c;
                io++;
            }
        }

        for (let x = 0; x < w; x++) {
            tgt[toff + 0] = out[x];
            tgt[toff + 1] = out[x + w];
            tgt[toff + 2] = out[x + w * 2];
            tgt[toff + 4] = out[x + w * 3];
            toff += 6;
        }
    }
};

TIFF.decode.ljpegDiff = function decodeLjpegDiff(data, prm, huff) {
    let getbithuff = TIFF.decode.getbithuff;
    let len = 0, diff = 0;
    len = getbithuff(data, prm, huff[0], huff);
    diff = getbithuff(data, prm, len, 0);
    if ((diff & 1 << len - 1) === 0) diff -= (1 << len) - 1;
    return diff;
};

TIFF.decode.decodeARW = function decodeDecodeARW(img, inp, oldOff, srcLength, tgt, toff) {
    let off = oldOff;
    let rawWidth = img.t256[0],
        height = img.t257[0],
        tiffBPS = img.t258[0];
    let bin = img.isLE ? TIFF.binLE : TIFF.binBE;

    let arw2 = rawWidth * height === srcLength || rawWidth * height * 1.5 === srcLength;

    if (!arw2) {
        height += 8;
        let prm = [off, 0, 0, 0];
        let huff = new Uint16Array(32770);
        let tab = [0xf11, 0xf10, 0xe0f, 0xd0e, 0xc0d, 0xb0c, 0xa0b, 0x90a, 0x809, 0x708, 0x607, 0x506, 0x405, 0x304, 0x303, 0x300, 0x202, 0x201
        ];
        let i = 0, n = 0, col = 0, row = 0, sum = 0;

        huff[0] = 15;
        for (n = i = 0; i < 18; i++) {
            let lim = 32768 >>> (tab[i] >>> 8);
            for (let c = 0; c < lim; c++) huff[++n] = tab[i];
        }
        for (col = rawWidth; col--;)
            for (row = 0; row < height + 1; row += 2) {
                if (row === height) row = 1;
                sum += TIFF.decode.ljpegDiff(inp, prm, huff);
                if (row < height) {
                    let clr = sum & 4095;
                    TIFF.decode.putsF(tgt, (row * rawWidth + col) * tiffBPS, clr << 16 - tiffBPS);
                }
            }
        return;
    }
    if (rawWidth * height * 1.5 === srcLength) {
        for (let i = 0; i < srcLength; i += 3) {
            let b0 = inp[off + i + 0],
                b1 = inp[off + i + 1],
                b2 = inp[off + i + 2];
            tgt[toff + i] = b1 << 4 | b0 >>> 4;
            tgt[toff + i + 1] = b0 << 4 | b2 >>> 4;
            tgt[toff + i + 2] = b2 << 4 | b1 >>> 4;
        }
        return;
    }

    let pix = new Uint16Array(16);
    let row = 0, col = 0, val = 0, max = 0, min = 0, imax = 0, imin = 0, sh = 0, bit = 0, i = 0, dp = 0;

    let data = new Uint8Array(rawWidth + 1);
    for (row = 0; row < height; row++) {
        for (let j = 0; j < rawWidth; j++) data[j] = inp[off++];
        for (dp = 0, col = 0; col < rawWidth - 30; dp += 16) {
            max = 0x7ff & (val = bin.readUint(data, dp));
            min = 0x7ff & val >>> 11;
            imax = 0x0f & val >>> 22;
            imin = 0x0f & val >>> 26;
            for (sh = 0; sh < 4 && 0x80 << sh <= max - min; sh++);
            for (bit = 30, i = 0; i < 16; i++)
                if (i === imax) pix[i] = max;
                else if (i === imin) pix[i] = min;
                else {
                    pix[i] = ((bin.readUshort(data, dp + (bit >> 3)) >>> (bit & 7) & 0x7f) << sh) + min;
                    if (pix[i] > 0x7ff) pix[i] = 0x7ff;
                    bit += 7;
                }
            for (i = 0; i < 16; i++, col += 2) {
                let clr = pix[i] << 1;
                TIFF.decode.putsF(tgt, (row * rawWidth + col) * tiffBPS, clr << 16 - tiffBPS);
            }
            col -= col & 1 ? 1 : 31;
        }
    }
};

TIFF.decode.decodeNikon = function decodeDecodeNikon(img, imgs, data, off, srcLength, tgt) {
    let nikonTree = [
        [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 5, 4, 3, 6, 2, 7, 1, 0, 8, 9, 11, 10, 12], [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0x39, 0x5a, 0x38, 0x27, 0x16, 5, 4, 3, 2, 1, 0, 11, 12, 12], [0, 0, 1, 4, 2, 3, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10, 11, 12
        ], [0, 0, 1, 4, 3, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 5, 6, 4, 7, 8, 3, 9, 2, 1, 0, 10, 11, 12, 13, 14
        ], [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 8, 0x5c, 0x4b, 0x3a, 0x29, 7, 6, 5, 4, 3, 2, 1, 0, 13, 14
        ], [0, 0, 1, 4, 2, 2, 3, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 7, 6, 8, 5, 9, 4, 10, 3, 11, 12, 2, 0, 1, 13, 14
        ]
    ];

    let rawWidth = img.t256[0],
        height = img.t257[0],
        tiffBPS = img.t258[0];

    let tree = 0,
        split = 0;
    let makedecoder = TIFF.decode.makedecoder;
    let getbithuff = TIFF.decode.getbithuff;

    let mn = imgs[0].exifIFD.makerNote,
        md = mn.t150 ? mn.t150 : mn.t140,
        mdo = 0;

    let ver0 = md[mdo++],
        ver1 = md[mdo++];
    if (ver0 === 0x49 || ver1 === 0x58) mdo += 2110;
    if (ver0 === 0x46) tree = 2;
    if (tiffBPS === 14) tree += 3;

    let vpred = [[0, 0], [0, 0]],
        bin = img.isLE ? TIFF.binLE : TIFF.binBE;
    for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
            vpred[i][j] = bin.readShort(md, mdo);
            mdo += 2;
        }

    let max = 1 << tiffBPS & 0x7fff,
        step = 0;
    let csize = bin.readShort(md, mdo);
    mdo += 2;
    if (csize > 1) step = Math.floor(max / (csize - 1));
    if (ver0 === 0x44 && ver1 === 0x20 && step > 0) split = bin.readShort(md, 562);

    let len = 0, shl = 0, diff = 0;
    let hpred = [0, 0];
    let huff = makedecoder(nikonTree[tree]);

    let prm = [off, 0, 0, 0];

    for (let row = 0; row < height; row++) {
        if (split && row === split) {
            huff = makedecoder(nikonTree[tree + 1]);
        }
        for (let col = 0; col < rawWidth; col++) {
            let i = getbithuff(data, prm, huff[0], huff);
            len = i & 15;
            shl = i >>> 4;
            diff = (getbithuff(data, prm, len - shl, 0) << 1) + 1 << shl >>> 1;
            if ((diff & 1 << len - 1) === 0)
                diff -= (1 << len) - (shl === 0 ? 1 : 0);
            if (col < 2) hpred[col] = vpred[row & 1][col] += diff;
            else hpred[col & 1] += diff;

            let clr = Math.min(Math.max(hpred[col & 1], 0), (1 << tiffBPS) - 1);
            let bti = (row * rawWidth + col) * tiffBPS;
            TIFF.decode.putsF(tgt, bti, clr << 16 - tiffBPS);
        }
    }
};

TIFF.decode.putsF = function decodePutsF(dt, pos, oldVal) {
    let val = oldVal << 8 - (pos & 7);
    let o = pos >>> 3;

    dt[o] |= val >>> 16;
    dt[o + 1] |= val >>> 8;
    dt[o + 2] |= val;
};

TIFF.decode.getbithuff = function decodeGetBitHuff(data, prm, nbits, huff) {
    let zeroAfterFF = 0;
    let c = 0;

    let off = prm[0],
        bitbuf = prm[1],
        vbits = prm[2],
        reset = prm[3];

    if (nbits === 0 || vbits < 0) return 0;
    while (!reset && vbits < nbits && (c = data[off++]) !== -1 &&
        !(reset = zeroAfterFF && c === 0xff && data[off++])) {
        bitbuf = (bitbuf << 8) + c;
        vbits += 8;
    }
    c = bitbuf << 32 - vbits >>> 32 - nbits;
    if (huff) {
        vbits -= huff[c + 1] >>> 8;
        c = huff[c + 1] & 255;
    } else
        vbits -= nbits;
    if (vbits < 0) throw new Error('Error occured readding huffman table');

    prm[0] = off;
    prm[1] = bitbuf;
    prm[2] = vbits;
    prm[3] = reset;

    return c;
};

TIFF.decode.makedecoder = function decodeMakeDecoder(source) {
    let max = 0, len = 0, h = 0, i = 0, j = 0;
    let huff = [];

    for (max = 16; max !== 0 && !source[max]; max--);
    let si = 17;

    huff[0] = max;
    for (h = len = 1; len <= max; len++)
        for (i = 0; i < source[len]; i++, ++si)
            for (j = 0; j < 1 << max - len; j++)
                if (h <= 1 << max)
                    huff[h++] = len << 8 | source[si];
    return huff;
};

TIFF.decode.decodeNewJPEG = function decodeDecodeNewJPEG(img, data, off, oldLen, tgt, toff) {
    let len = Math.min(oldLen, data.length - off);
    let tables = img.t347,
        tlen = tables ? tables.length : 0,
        buff = new Uint8Array(tlen + len);

    if (tables) {
        let SOI = 216,
            EOI = 217,
            boff = 0;
        for (let i = 0; i < tlen - 1; i++) {
            if (tables[i] === 255 && tables[i + 1] === EOI) break;
            buff[boff++] = tables[i];
        }

        let byte1 = data[off],
            byte2 = data[off + 1];
        if (byte1 !== 255 || byte2 !== SOI) {
            buff[boff++] = byte1;
            buff[boff++] = byte2;
        }
        for (let i = 2; i < len; i++) buff[boff++] = data[off + i];
    } else
        for (let i = 0; i < len; i++) buff[i] = data[off + i];

    if (img.t262[0] === 32803 || img.t259[0] === 7 && img.t262[0] === 34892) {
        let bps = img.t258[0];

        let out = TIFF.LosslessJpegDecode(buff),
            olen = out.length;

        if (false) { } else if (bps === 16) {
            if (img.isLE)
                for (let i = 0; i < olen; i++) {
                    tgt[toff + (i << 1)] = out[i] & 255;
                    tgt[toff + (i << 1) + 1] = out[i] >>> 8;
                }
            else
                for (let i = 0; i < olen; i++) {
                    tgt[toff + (i << 1)] = out[i] >>> 8;
                    tgt[toff + (i << 1) + 1] = out[i] & 255;
                }
        } else if (bps === 14 || bps === 12 || bps === 10) {
            let rst = 16 - bps;
            for (let i = 0; i < olen; i++) TIFF.decode.putsF(tgt, i * bps, out[i] << rst);
        } else if (bps === 8) {
            for (let i = 0; i < olen; i++) tgt[toff + i] = out[i];
        } else throw new Error(`Unsupported bit depth ${bps}`);
    } else {
        let parser = new TIFF.JpegDecoder();

        parser.parse(buff);

        let decoded = parser.getData({
            'width': parser.width,
            'height': parser.height,
            'forceRGB': true,
            'isSourcePDF': false
        });
        for (let i = 0; i < decoded.length; i++) tgt[toff + i] = decoded[i];
    }

    if (img.t262[0] === 6) img.t262[0] = 2;
};

let sosMarker = false;

TIFF.decode.decodeOldJPEGInit = function decodeDecodeOldJPEGInit(img, data, off) {
    let SOI = 216,
        DQT = 219,
        DHT = 196,
        DRI = 221,
        SOF0 = 192,
        SOS = 218;
    let joff = 0,
        soff = 0,
        tables = null, isTiled = false,
        i = 0, j = 0, k = 0;
    let jpgIchgFmt = img.t513,
        jifoff = jpgIchgFmt ? jpgIchgFmt[0] : 0;
    let jpgIchgFmtLen = img.t514,
        jiflen = jpgIchgFmtLen ? jpgIchgFmtLen[0] : 0;
    let soffTag = img.t324 || img.t273 || jpgIchgFmt;
    let ycbcrss = img.t530,
        ssx = 0,
        ssy = 0;
    let spp = img.t277 ? img.t277[0] : 1;
    let jpgresint = img.t515;

    if (soffTag) {
        soff = soffTag[0];
        isTiled = soffTag.length > 1;
    }

    if (!isTiled) {
        if (data[off] === 255 && data[off + 1] === SOI) return {
            jpegOffset: off
        };
        if (jpgIchgFmt) {
            if (data[off + jifoff] === 255 && data[off + jifoff + 1] === SOI) joff = off + jifoff;

            if (joff) return {
                jpegOffset: joff
            };
        }
    }

    if (ycbcrss) {
        ssx = ycbcrss[0];
        ssy = ycbcrss[1];
    }

    if (jpgIchgFmt)
        if (jpgIchgFmtLen)
            if (jiflen >= 2 && jifoff + jiflen <= soff) {
                if (data[off + jifoff + jiflen - 2] === 255 && data[off + jifoff + jiflen - 1] === SOI) tables = new Uint8Array(jiflen - 2);
                else tables = new Uint8Array(jiflen);

                for (i = 0; i < tables.length; i++) tables[i] = data[off + jifoff + i];
            }

    if (!tables) {
        let ooff = 0,
            out = [];
        out[ooff++] = 255;
        out[ooff++] = SOI;

        let qtables = img.t519;
        if (!qtables) throw new Error('JPEGQTables tag is missing');
        for (i = 0; i < qtables.length; i++) {
            out[ooff++] = 255;
            out[ooff++] = DQT;
            out[ooff++] = 0;
            out[ooff++] = 67;
            out[ooff++] = i;
            for (j = 0; j < 64; j++) out[ooff++] = data[off + qtables[i] + j];
        }

        for (k = 0; k < 2; k++) {
            let htables = img[k === 0 ? 't520' : 't521'];
            if (!htables) throw new Error(`${k === 0 ? 'JPEGDCTables' : 'JPEGACTables'} tag is missing`);
            for (i = 0; i < htables.length; i++) {
                out[ooff++] = 255;
                out[ooff++] = DHT;

                let nc = 19;
                for (j = 0; j < 16; j++) nc += data[off + htables[i] + j];

                out[ooff++] = nc >>> 8;
                out[ooff++] = nc & 255;
                out[ooff++] = i | k << 4;
                for (j = 0; j < 16; j++) out[ooff++] = data[off + htables[i] + j];
                for (j = 0; j < nc; j++) out[ooff++] = data[off + htables[i] + 16 + j];
            }
        }

        out[ooff++] = 255;
        out[ooff++] = SOF0;
        out[ooff++] = 0;
        out[ooff++] = 8 + 3 * spp;
        out[ooff++] = 8;
        out[ooff++] = img.height >>> 8 & 255;
        out[ooff++] = img.height & 255;
        out[ooff++] = img.width >>> 8 & 255;
        out[ooff++] = img.width & 255;
        out[ooff++] = spp;

        if (spp === 1) {
            out[ooff++] = 1;
            out[ooff++] = 17;
            out[ooff++] = 0;
        } else
            for (i = 0; i < 3; i++) {
                out[ooff++] = i + 1;
                out[ooff++] = i !== 0 ? 17 : (ssx & 15) << 4 | ssy & 15;
                out[ooff++] = i;
            }

        if (jpgresint && jpgresint[0] !== 0) {
            out[ooff++] = 255;
            out[ooff++] = DRI;
            out[ooff++] = 0;
            out[ooff++] = 4;
            out[ooff++] = jpgresint[0] >>> 8 & 255;
            out[ooff++] = jpgresint[0] & 255;
        }

        tables = new Uint8Array(out);
    }

    let sofpos = -1;
    i = 0;
    while (i < tables.length - 1) {
        if (tables[i] === 255 && tables[i + 1] === SOF0) {
            sofpos = i;
            break;
        }
        i++;
    }

    if (sofpos === -1) {
        let tmptab = new Uint8Array(tables.length + 10 + 3 * spp);
        tmptab.set(tables);
        let tmpoff = tables.length;
        sofpos = tables.length;
        tables = tmptab;

        tables[tmpoff++] = 255;
        tables[tmpoff++] = SOF0;
        tables[tmpoff++] = 0;
        tables[tmpoff++] = 8 + 3 * spp;
        tables[tmpoff++] = 8;
        tables[tmpoff++] = img.height >>> 8 & 255;
        tables[tmpoff++] = img.height & 255;
        tables[tmpoff++] = img.width >>> 8 & 255;
        tables[tmpoff++] = img.width & 255;
        tables[tmpoff++] = spp;
        if (spp === 1) {
            tables[tmpoff++] = 1;
            tables[tmpoff++] = 17;
            tables[tmpoff++] = 0;
        } else
            for (i = 0; i < 3; i++) {
                tables[tmpoff++] = i + 1;
                tables[tmpoff++] = i !== 0 ? 17 : (ssx & 15) << 4 | ssy & 15;
                tables[tmpoff++] = i;
            }
    }

    if (data[soff] === 255 && data[soff + 1] === SOS) {
        let soslen = data[soff + 2] << 8 | data[soff + 3];
        sosMarker = new Uint8Array(soslen + 2);
        sosMarker[0] = data[soff];
        sosMarker[1] = data[soff + 1];
        sosMarker[2] = data[soff + 2];
        sosMarker[3] = data[soff + 3];
        for (i = 0; i < soslen - 2; i++) sosMarker[i + 4] = data[soff + i + 4];
    } else {
        sosMarker = new Uint8Array(2 + 6 + 2 * spp);
        let sosoff = 0;
        sosMarker[sosoff++] = 255;
        sosMarker[sosoff++] = SOS;
        sosMarker[sosoff++] = 0;
        sosMarker[sosoff++] = 6 + 2 * spp;
        sosMarker[sosoff++] = spp;
        if (spp === 1) {
            sosMarker[sosoff++] = 1;
            sosMarker[sosoff++] = 0;
        } else
            for (i = 0; i < 3; i++) {
                sosMarker[sosoff++] = i + 1;
                sosMarker[sosoff++] = i << 4 | i;
            }
        sosMarker[sosoff++] = 0;
        sosMarker[sosoff++] = 63;
        sosMarker[sosoff++] = 0;
    }

    return {
        jpegOffset: off,
        tables,
        sosMarker,
        sofPosition: sofpos
    };
};

TIFF.decode.decodeOldJPEG = function decodeDecodeOldJPEG(img, data, off, len, tgt, toff) {
    let i = 0, dlen = 0, tlen = 0, buff = null, buffoff = 0;
    let jpegData = TIFF.decode.decodeOldJPEGInit(img, data, off);

    if (jpegData.jpegOffset) {
        dlen = off + len - jpegData.jpegOffset;
        buff = new Uint8Array(dlen);
        for (i = 0; i < dlen; i++) buff[i] = data[jpegData.jpegOffset + i];
    } else {
        tlen = jpegData.tables.length;
        buff = new Uint8Array(tlen + jpegData.sosMarker.length + len + 2);
        buff.set(jpegData.tables);
        buffoff = tlen;

        buff[jpegData.sofPosition + 5] = img.height >>> 8 & 255;
        buff[jpegData.sofPosition + 6] = img.height & 255;
        buff[jpegData.sofPosition + 7] = img.width >>> 8 & 255;
        buff[jpegData.sofPosition + 8] = img.width & 255;

        if (data[off] !== 255 || data[off + 1] !== 218) {
            buff.set(jpegData.sosMarker, buffoff);
            buffoff += sosMarker.length;
        }
        for (i = 0; i < len; i++) buff[buffoff++] = data[off + i];
        buff[buffoff++] = 255;
        buff[buffoff++] = 217;
    }

    let parser = new TIFF.JpegDecoder();
    parser.parse(buff);
    let decoded = parser.getData({
        'width': parser.width,
        'height': parser.height,
        'forceRGB': true,
        'isSourcePDF': false
    });
    for (i = 0; i < decoded.length; i++) {
        tgt[toff + i] = decoded[i];
    }

    if (img.t262 && img.t262[0] === 6) img.t262[0] = 2;
};

TIFF.decode.decodePackBits = function decodeDecodePackBits(data, oldOff, len, tgt, oldToff) {
    let off = oldOff;
    let toff = oldToff;
    let sa = new Int8Array(data.buffer),
        ta = new Int8Array(tgt.buffer),
        lim = off + len;
    while (off < lim) {
        let n = sa[off];
        off++;
        if (n >= 0 && n < 128)
            for (let i = 0; i < n + 1; i++) {
                ta[toff] = sa[off];
                toff++;
                off++;
            }
        if (n >= -127 && n < 0) {
            for (let i = 0; i < -n + 1; i++) {
                ta[toff] = sa[off];
                toff++;
            }
            off++;
        }
    }
    return toff;
};

TIFF.decode.decodeThunder = function decodeDecodeThunder(data, oldOff, len, tgt, toff) {
    let off = oldOff;
    let d2 = [0, 1, 0, -1],
        d3 = [0, 1, 2, 3, 0, -3, -2, -1];
    let lim = off + len,
        qoff = toff * 2,
        px = 0;
    while (off < lim) {
        let b = data[off],
            msk = b >>> 6,
            n = b & 63;
        off++;
        if (msk === 3) {
            px = n & 15;
            tgt[qoff >>> 1] |= px << 4 * (1 - qoff & 1);
            qoff++;
        }
        if (msk === 0)
            for (let i = 0; i < n; i++) {
                tgt[qoff >>> 1] |= px << 4 * (1 - qoff & 1);
                qoff++;
            }
        if (msk === 2)
            for (let i = 0; i < 2; i++) {
                let d = n >>> 3 * (1 - i) & 7;
                if (d !== 4) {
                    px += d3[d];
                    tgt[qoff >>> 1] |= px << 4 * (1 - qoff & 1);
                    qoff++;
                }
            }
        if (msk === 1)
            for (let i = 0; i < 3; i++) {
                let d = n >>> 2 * (2 - i) & 3;
                if (d !== 2) {
                    px += d2[d];
                    tgt[qoff >>> 1] |= px << 4 * (1 - qoff & 1);
                    qoff++;
                }
            }
    }
};

TIFF.decode.dmap = {
    '1': 0,
    '011': 1,
    '000011': 2,
    '0000011': 3,
    '010': -1,
    '000010': -2,
    '0000010': -3
};
TIFF.decode.lens = (function decodeDecodeLens() {
    function addKeys(lens, arr, i0, inc) {
        for (let i = 0; i < arr.length; i++) lens[arr[i]] = i0 + i * inc;
    }

    let termW = '00110101,000111,0111,1000,1011,1100,1110,1111,10011,10100,00111,01000,001000,000011,110100,110101,' +
        '101010,101011,0100111,0001100,0001000,0010111,0000011,0000100,0101000,0101011,0010011,0100100,0011000,00000010,00000011,00011010,' +
        '00011011,00010010,00010011,00010100,00010101,00010110,00010111,00101000,00101001,00101010,00101011,00101100,00101101,00000100,00000101,00001010,' +
        '00001011,01010010,01010011,01010100,01010101,00100100,00100101,01011000,01011001,01011010,01011011,01001010,01001011,00110010,00110011,00110100';

    let termB = '0000110111,010,11,10,011,0011,0010,00011,000101,000100,0000100,0000101,0000111,00000100,00000111,000011000,' +
        '0000010111,0000011000,0000001000,00001100111,00001101000,00001101100,00000110111,00000101000,00000010111,00000011000,000011001010,000011001011,000011001100,000011001101,000001101000,000001101001,' +
        '000001101010,000001101011,000011010010,000011010011,000011010100,000011010101,000011010110,000011010111,000001101100,000001101101,000011011010,000011011011,000001010100,000001010101,000001010110,000001010111,' +
        '000001100100,000001100101,000001010010,000001010011,000000100100,000000110111,000000111000,000000100111,000000101000,000001011000,000001011001,000000101011,000000101100,000001011010,000001100110,000001100111';

    let makeW = '11011,10010,010111,0110111,00110110,00110111,01100100,01100101,01101000,01100111,011001100,011001101,011010010,011010011,011010100,011010101,011010110,' +
        '011010111,011011000,011011001,011011010,011011011,010011000,010011001,010011010,011000,010011011';

    let makeB = '0000001111,000011001000,000011001001,000001011011,000000110011,000000110100,000000110101,0000001101100,0000001101101,0000001001010,0000001001011,0000001001100,' +
        '0000001001101,0000001110010,0000001110011,0000001110100,0000001110101,0000001110110,0000001110111,0000001010010,0000001010011,0000001010100,0000001010101,0000001011010,' +
        '0000001011011,0000001100100,0000001100101';

    let makeA = '00000001000,00000001100,00000001101,000000010010,000000010011,000000010100,000000010101,000000010110,000000010111,000000011100,000000011101,000000011110,000000011111';

    termW = termW.split(',');
    termB = termB.split(',');
    makeW = makeW.split(',');
    makeB = makeB.split(',');
    makeA = makeA.split(',');

    let lensW = {},
        lensB = {};
    addKeys(lensW, termW, 0, 1);
    addKeys(lensW, makeW, 64, 64);
    addKeys(lensW, makeA, 1792, 64);
    addKeys(lensB, termB, 0, 1);
    addKeys(lensB, makeB, 64, 64);
    addKeys(lensB, makeA, 1792, 64);
    return [lensW, lensB];
}());

TIFF.decode.decodeG4 = function decodeDecodeG4(data, off, slen, tgt, toff, w, fo) {
    let U = TIFF.decode,
        boff = off << 3,
        len = 0,
        wrd = '';
    let line = [],
        pline = [];
    for (let i = 0; i < w; i++) pline.push(0);
    pline = U.makeDiff(pline);
    let a0 = 0,
        a1 = 0,
        b1 = 0,
        b2 = 0,
        clr = 0;
    let y = 0,
        mode = '',
        toRead = 0;
    let bipl = Math.ceil(w / 8) * 8;

    while (boff >>> 3 < off + slen) {
        b1 = U.findDiff(pline, a0 + (a0 === 0 ? 0 : 1), 1 - clr), b2 = U.findDiff(pline, b1, clr);
        let bit = 0;
        if (fo === 1) bit = data[boff >>> 3] >>> 7 - (boff & 7) & 1;
        if (fo === 2) bit = data[boff >>> 3] >>> (boff & 7) & 1;
        boff++;
        wrd += bit;
        if (mode === 'H') {
            if (U.lens[clr][wrd]) {
                let dl = U.lens[clr][wrd];
                wrd = '';
                len += dl;
                if (dl < 64) {
                    U.addNtimes(line, len, clr);
                    a0 += len;
                    clr = 1 - clr;
                    len = 0;
                    toRead--;
                    if (toRead === 0) mode = '';
                }
            }
        } else {
            if (wrd === '0001') {
                wrd = '';
                U.addNtimes(line, b2 - a0, clr);
                a0 = b2;
            }
            if (wrd === '001') {
                wrd = '';
                mode = 'H';
                toRead = 2;
            }
            if (U.dmap[wrd]) {
                a1 = b1 + U.dmap[wrd];
                U.addNtimes(line, a1 - a0, clr);
                a0 = a1;
                wrd = '';
                clr = 1 - clr;
            }
        }
        if (line.length === w && mode === '') {
            U.writeBits(line, tgt, toff * 8 + y * bipl);
            clr = 0;
            y++;
            a0 = 0;
            pline = U.makeDiff(line);
            line = [];
        }
    }
};

TIFF.decode.findDiff = function decodeFindDiff(line, x, clr) {
    for (let i = 0; i < line.length; i += 2)
        if (line[i] >= x && line[i + 1] === clr) return line[i];
};

TIFF.decode.makeDiff = function decodeMakeDiff(line) {
    let out = [];
    if (line[0] === 1) out.push(0, 1);
    for (let i = 1; i < line.length; i++)
        if (line[i - 1] !== line[i]) out.push(i, line[i]);
    out.push(line.length, 0, line.length, 1);
    return out;
};

TIFF.decode.decodeG2 = function decodeDecodeG2(data, off, slen, tgt, toff, w, fo) {
    let U = TIFF.decode,
        boff = off << 3,
        len = 0,
        wrd = '';
    let line = [];
    let clr = 0;
    let y = 0;
    let bipl = Math.ceil(w / 8) * 8;

    while (boff >>> 3 < off + slen) {
        let bit = 0;
        if (fo === 1) bit = data[boff >>> 3] >>> 7 - (boff & 7) & 1;
        if (fo === 2) bit = data[boff >>> 3] >>> (boff & 7) & 1;
        boff++;
        wrd += bit;

        len = U.lens[clr][wrd];
        if (len) {
            U.addNtimes(line, len, clr);
            wrd = '';
            if (len < 64) clr = 1 - clr;
            if (line.length === w) {
                U.writeBits(line, tgt, toff * 8 + y * bipl);
                line = [];
                y++;
                clr = 0;
                if ((boff & 7) !== 0) boff += 8 - (boff & 7);
                if (len >= 64) boff += 8;
            }
        }
    }
};

TIFF.decode.decodeG3 = function decodeDecodeG3(data, off, slen, tgt, toff, w, fo, twoDim) {
    let U = TIFF.decode,
        boff = off << 3,
        len = 0,
        wrd = '';
    let line = [],
        pline = [];
    for (let i = 0; i < w; i++) line.push(0);
    let a0 = 0,
        a1 = 0,
        b1 = 0,
        b2 = 0,
        clr = 0;
    let y = -1,
        mode = '',
        toRead = 0,
        is1D = true;
    let bipl = Math.ceil(w / 8) * 8;
    while (boff >>> 3 < off + slen) {
        b1 = U.findDiff(pline, a0 + (a0 === 0 ? 0 : 1), 1 - clr), b2 = U.findDiff(pline, b1, clr);
        let bit = 0;
        if (fo === 1) bit = data[boff >>> 3] >>> 7 - (boff & 7) & 1;
        if (fo === 2) bit = data[boff >>> 3] >>> (boff & 7) & 1;
        boff++;
        wrd += bit;

        if (is1D) {
            if (U.lens[clr][wrd]) {
                let dl = U.lens[clr][wrd];
                wrd = '';
                len += dl;
                if (dl < 64) {
                    U.addNtimes(line, len, clr);
                    clr = 1 - clr;
                    len = 0;
                }
            }
        } else if (mode === 'H') {
            if (U.lens[clr][wrd]) {
                let dl = U.lens[clr][wrd];
                wrd = '';
                len += dl;
                if (dl < 64) {
                    U.addNtimes(line, len, clr);
                    a0 += len;
                    clr = 1 - clr;
                    len = 0;
                    toRead--;
                    if (toRead === 0) mode = '';
                }
            }
        } else {
            if (wrd === '0001') {
                wrd = '';
                U.addNtimes(line, b2 - a0, clr);
                a0 = b2;
            }
            if (wrd === '001') {
                wrd = '';
                mode = 'H';
                toRead = 2;
            }
            if (U.dmap[wrd]) {
                a1 = b1 + U.dmap[wrd];
                U.addNtimes(line, a1 - a0, clr);
                a0 = a1;
                wrd = '';
                clr = 1 - clr;
            }
        }
        if (wrd.endsWith('000000000001')) {
            if (y >= 0) U.writeBits(line, tgt, toff * 8 + y * bipl);
            if (twoDim) {
                if (fo === 1) is1D = (data[boff >>> 3] >>> 7 - (boff & 7) & 1) === 1;
                if (fo === 2) is1D = (data[boff >>> 3] >>> (boff & 7) & 1) === 1;
                boff++;
            }
            wrd = '';
            clr = 0;
            y++;
            a0 = 0;
            pline = U.makeDiff(line);
            line = [];
        }
    }
    if (line.length === w) U.writeBits(line, tgt, toff * 8 + y * bipl);
};

TIFF.decode.addNtimes = function decodeAddNtimes(arr, n, val) {
    for (let i = 0; i < n; i++) arr.push(val);
};

TIFF.decode.writeBits = function decodeWriteBits(bits, tgt, boff) {
    for (let i = 0; i < bits.length; i++) tgt[boff + i >>> 3] |= bits[i] << 7 - (boff + i & 7);
};

TIFF.decode.decodeLZW = TIFF.decode.decodeLZW = (function decodeDecodeLZW() {
    let e = 0, U = null, Z = null, u = 0, K = 0, V = 0, g = 0, N = 0, h = new Uint32Array(4096 * 4), w = 0;

    function O() {
        let S = e >>> 3,
            A = U[S] << 16 | U[S + 1] << 8 | U[S + 2],
            j = A >>> 24 - (e & 7) - V & (1 << V) - 1;
        e += V;
        return j;
    }

    function m(S) {
        if (S === w) return;
        w = S;
        g = 1 << S;
        N = g + 1;
        for (let A = 0; A < N + 1; A++) {
            h[4 * A] = h[4 * A + 3] = A;
            h[4 * A + 1] = 65535;
            h[4 * A + 2] = 1;
        }
    }

    function i(S) {
        V = S + 1;
        K = N + 1;
    }

    function D(S) {
        let A = S << 2,
            j = h[A + 2],
            a = u + j - 1;
        while (A !== 65535) {
            Z[a--] = h[A];
            A = h[A + 1];
        }
        u += j;
    }

    function L(S, A) {
        let j = K << 2,
            a = S << 2;
        h[j] = h[(A << 2) + 3];
        h[j + 1] = a;
        h[j + 2] = h[a + 2] + 1;
        h[j + 3] = h[a + 3];
        K++;
        if (K + 1 === 1 << V && V !== 12) V++;
    }

    function T(S, A, j, a, n, q) {
        e = A << 3;
        U = S;
        Z = a;
        u = n;
        let B = A + j << 3,
            _ = 0,
            t = 0;
        m(q);
        i(q);
        while (e < B && (_ = O()) !== N) {
            if (_ === g) {
                i(q);
                _ = O();
                if (_ === N) break;
                D(_);
            } else if (_ < K) {
                D(_);
                L(t, _);
            } else {
                L(t, t);
                D(K - 1);
            }
            t = _;
        }
        return u;
    }

    return T;
}());

TIFF.tags = {};

TIFF.types = (function utifTypes() {
    let main = new Array(250);
    main.fill(0);
    main = main.concat([0, 0, 0, 0, 4, 3, 3, 3, 3, 3, 0, 0, 3, 0, 0, 0, 3, 0, 0, 2, 2, 2, 2, 4, 3, 0, 0, 3, 4, 4, 3, 3, 5, 5, 3, 2, 5, 5, 0, 0, 0, 0, 4, 4, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3, 5, 5, 3, 0, 3, 3, 4, 4, 4, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    let rest = {
        33432: 2,
        33434: 5,
        33437: 5,
        34665: 4,
        34850: 3,
        34853: 4,
        34855: 3,
        34864: 3,
        34866: 4,
        36864: 7,
        36867: 2,
        36868: 2,
        37121: 7,
        37377: 10,
        37378: 5,
        37380: 10,
        37381: 5,
        37383: 3,
        37384: 3,
        37385: 3,
        37386: 5,
        37510: 7,
        37520: 2,
        37521: 2,
        37522: 2,
        40960: 7,
        40961: 3,
        40962: 4,
        40963: 4,
        40965: 4,
        41486: 5,
        41487: 5,
        41488: 3,
        41985: 3,
        41986: 3,
        41987: 3,
        41988: 5,
        41989: 3,
        41990: 3,
        41993: 3,
        41994: 3,
        41995: 7,
        41996: 3,
        42032: 2,
        42033: 2,
        42034: 5,
        42036: 2,
        42037: 2,
        59932: 7
    };
    return {
        basic: {
            main,
            rest
        },
        gps: {
            main: [1, 2, 5, 2, 5, 1, 5, 5, 0, 9],
            rest: {
                18: 2,
                29: 2
            }
        }
    };
}());

TIFF.readIFD = function utifReadIFD(bin, data, oldOffset, ifds, depth, prm) {
    let offset = oldOffset;
    let cnt = bin.readUshort(data, offset);
    offset += 2;
    let ifd = {};

    for (let i = 0; i < cnt; i++) {
        let tag = bin.readUshort(data, offset);
        offset += 2;
        let type = bin.readUshort(data, offset);
        offset += 2;
        let num = bin.readUint(data, offset);
        offset += 4;
        let voff = bin.readUint(data, offset);
        offset += 4;

        let arr = [];

        if (type === 1 || type === 7) {
            let no = num < 5 ? offset - 4 : voff;
            if (no + num > data.buffer.byteLength) num = data.buffer.byteLength - no;
            arr = new Uint8Array(data.buffer, no, num);
        }
        if (type === 2) {
            let o0 = num < 5 ? offset - 4 : voff,
                c = data[o0],
                len = Math.max(0, Math.min(num - 1, data.length - o0));
            if (c < 128 || len === 0) arr.push(bin.readASCII(data, o0, len));
            else arr = new Uint8Array(data.buffer, o0, len);
        }
        if (type === 3) {
            for (let j = 0; j < num; j++) arr.push(bin.readUshort(data, (num < 3 ? offset - 4 : voff) + 2 * j));
        }
        if (type === 4 ||
            type === 13) {
            for (let j = 0; j < num; j++) arr.push(bin.readUint(data, (num < 2 ? offset - 4 : voff) + 4 * j));
        }
        if (type === 5 || type === 10) {
            let ri = type === 5 ? bin.readUint : bin.readInt;
            for (let j = 0; j < num; j++) arr.push([ri(data, voff + j * 8), ri(data, voff + j * 8 + 4)]);
        }
        if (type === 8) {
            for (let j = 0; j < num; j++) arr.push(bin.readShort(data, (num < 3 ? offset - 4 : voff) + 2 * j));
        }
        if (type === 9) {
            for (let j = 0; j < num; j++) arr.push(bin.readInt(data, (num < 2 ? offset - 4 : voff) + 4 * j));
        }
        if (type === 11) {
            for (let j = 0; j < num; j++) arr.push(bin.readFloat(data, voff + j * 4));
        }
        if (type === 12) {
            for (let j = 0; j < num; j++) arr.push(bin.readDouble(data, voff + j * 8));
        }

        if (num !== 0 && arr.length === 0) {
            if (i === 0) return;
            continue;
        }

        ifd[`t${tag}`] = arr;

        if (tag === 330 && ifd.t272 && ifd.t272[0] === 'DSLR-A100') { } else if (tag === 330 || tag === 34665 || tag === 34853 || tag === 50740 && bin.readUshort(data, bin.readUint(arr, 0)) < 300 || tag === 61440) {
            let oarr = tag === 50740 ? [bin.readUint(arr, 0)] : arr;
            let subfd = [];
            for (let j = 0; j < oarr.length; j++) TIFF.readIFD(bin, data, oarr[j], subfd, depth + 1, prm);
            if (tag === 330) ifd.subIFD = subfd;
            if (tag === 34665) ifd.exifIFD = subfd[0];
            if (tag === 34853) ifd.gpsiIFD = subfd[0];
            if (tag === 50740) ifd.dngPrvt = subfd[0];
            if (tag === 61440) ifd.fujiIFD = subfd[0];
        }
        if (tag === 37500 && prm.parseMN) {
            let mn = arr;

            if (bin.readASCII(mn, 0, 5) === 'Nikon') ifd.makerNote = TIFF.decode(mn.slice(10)
                .buffer)[0];
            else if (bin.readASCII(mn, 0, 5) === 'OLYMP' || bin.readASCII(mn, 0, 9) === 'OM SYSTEM') {
                let inds = [8208, 8224, 8240, 8256, 8272];
                let subsub = [];

                if (mn[1] === 77) TIFF.readIFD(bin, mn, 16, subsub, depth + 1, prm);
                else if (mn[5] === 85) TIFF.readIFD(bin, mn, 12, subsub, depth + 1, prm);
                else TIFF.readIFD(bin, mn, 8, subsub, depth + 1, prm);

                let obj = ifd.makerNote = subsub.pop();
                for (let j = 0; j < inds.length; j++) {
                    let k = `t${inds[j]}`;
                    if (!obj[k]) continue;
                    TIFF.readIFD(bin, mn, obj[k][0], subsub, depth + 1, prm);
                    obj[k] = subsub.pop();
                }
                if (obj.t12288) {
                    TIFF.readIFD(bin, obj.t12288, 0, subsub, depth + 1, prm);
                    obj.t12288 = subsub.pop();
                }
            } else if (bin.readUshort(data, voff) < 300 && bin.readUshort(data, voff + 4) <= 12) {
                let subsub = [];
                TIFF.readIFD(bin, data, voff, subsub, depth + 1, prm);
                ifd.makerNote = subsub[0];
            }
        }
    }
    ifds.push(ifd);
    return offset;
};

TIFF.writeIFD = function utifWriteIFD(bin, types, data, oldOffset, ifd) {
    let offset = oldOffset;
    let keys = Object.keys(ifd),
        knum = keys.length;
    if (ifd.exifIFD) knum--;
    if (ifd.gpsiIFD) knum--;
    bin.writeUshort(data, offset, knum);
    offset += 2;

    let eoff = offset + knum * 12 + 4;

    for (let ki = 0; ki < keys.length; ki++) {
        let key = keys[ki];
        if (key === 't34665' || key === 't34853') continue;
        if (key === 'exifIFD') key = 't34665';
        if (key === 'gpsiIFD') key = 't34853';
        let tag = parseInt(key.slice(1), 10),
            type = types.main[tag];
        if (!type) type = types.rest[tag];
        if (!type || type === 0) throw new Error(`Unknown type of tag: ${tag}`);

        let val = ifd[key];
        if (tag === 34665) {
            let outp = TIFF.writeIFD(bin, types, data, eoff, ifd.exifIFD);
            val = [eoff];
            eoff = outp[1];
        }
        if (tag === 34853) {
            let outp = TIFF.writeIFD(bin, TIFF.types.gps, data, eoff, ifd.gpsiIFD);
            val = [eoff];
            eoff = outp[1];
        }
        if (type === 2) val = `${val[0]}\u0000`;
        let num = val.length;
        bin.writeUshort(data, offset, tag);
        offset += 2;
        bin.writeUshort(data, offset, type);
        offset += 2;
        bin.writeUint(data, offset, num);
        offset += 4;

        let dlen = [-1, 1, 1, 2, 4, 8, 0, 1, 0, 4, 8, 0, 8][type] * num;
        let toff = offset;
        if (dlen > 4) {
            bin.writeUint(data, offset, eoff);
            toff = eoff;
        }

        if (type === 1 || type === 7) {
            for (let i = 0; i < num; i++) data[toff + i] = val[i];
        } else if (type === 2) {
            bin.writeASCII(data, toff, val);
        } else if (type === 3) {
            for (let i = 0; i < num; i++) bin.writeUshort(data, toff + 2 * i, val[i]);
        } else if (type === 4) {
            for (let i = 0; i < num; i++) bin.writeUint(data, toff + 4 * i, val[i]);
        } else if (type === 5 || type === 10) {
            let wr = type === 5 ? bin.writeUint : bin.writeInt;
            for (let i = 0; i < num; i++) {
                let v = val[i],
                    nu = v[0],
                    de = v[1];
                if (nu === null) throw new Error('Error occured while writing IFD');
                wr(data, toff + 8 * i, nu);
                wr(data, toff + 8 * i + 4, de);
            }
        } else if (type === 9) {
            for (let i = 0; i < num; i++) bin.writeInt(data, toff + 4 * i, val[i]);
        } else if (type === 12) {
            for (let i = 0; i < num; i++) bin.writeDouble(data, toff + 8 * i, val[i]);
        } else throw type;

        if (dlen > 4) {
            dlen += dlen & 1;
            eoff += dlen;
        }
        offset += 4;
    }
    return [offset, eoff];
};

TIFF.toRGBA8 = function utifToRGBA8(out, oldScl) {
    function gamma(x) {
        return x < 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1.0 / 2.4) - 0.055;
    }

    let scl = oldScl;
    let w = out.width,
        h = out.height,
        area = w * h,
        data = out.data;
    let img = new Uint8Array(area * 4);

    let intp = out.t262 ? out.t262[0] : 2,
        bps = out.t258 ? Math.min(32, out.t258[0]) : 1;
    if (!out.t262 && bps === 1) intp = 0;

    let smpls = 0;

    if (out.t277) smpls = out.t277[0];
    else if (out.t258) smpls = out.t258.length;
    else smpls = [1, 1, 3, 1, 1, 4, 3][intp];

    let sfmt = out.t339 ? out.t339[0] : null;
    if (intp === 1 && bps === 32 && sfmt !== 3) throw new Error('Error occured while converting to RGBA8');
    let bpl = Math.ceil(smpls * bps * w / 8);

    if (intp === 0) {
        scl = 1 / 256;
        for (let y = 0; y < h; y++) {
            let off = y * bpl,
                io = y * w;
            if (bps === 1)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        px = data[off + (i >> 3)] >> 7 - (i & 7) & 1;
                    img[qi] = img[qi + 1] = img[qi + 2] = (1 - px) * 255;
                    img[qi + 3] = 255;
                }
            if (bps === 4)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        px = data[off + (i >> 1)] >> 4 - 4 * (i & 1) & 15;
                    img[qi] = img[qi + 1] = img[qi + 2] = (15 - px) * 17;
                    img[qi + 3] = 255;
                }
            if (bps === 8)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        px = data[off + i];
                    img[qi] = img[qi + 1] = img[qi + 2] = 255 - px;
                    img[qi + 3] = 255;
                }
            if (bps === 16)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        o = off + 2 * i,
                        px = data[o + 1] << 8 | data[o];
                    img[qi] = img[qi + 1] = img[qi + 2] = Math.min(255, 255 - ~~(px * scl));
                    img[qi + 3] = 255;
                }
        }
    } else if (intp === 1) {
        if (!scl) scl = 1 / 256;
        let f32 = (data.length & 3) === 0 ? new Float32Array(data.buffer) : null;

        for (let y = 0; y < h; y++) {
            let off = y * bpl,
                io = y * w;
            if (bps === 1)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        px = data[off + (i >> 3)] >> 7 - (i & 7) & 1;
                    img[qi] = img[qi + 1] = img[qi + 2] = px * 255;
                    img[qi + 3] = 255;
                }
            if (bps === 2)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        px = data[off + (i >> 2)] >> 6 - 2 * (i & 3) & 3;
                    img[qi] = img[qi + 1] = img[qi + 2] = px * 85;
                    img[qi + 3] = 255;
                }
            if (bps === 8)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        px = data[off + i * smpls];
                    img[qi] = img[qi + 1] = img[qi + 2] = px;
                    img[qi + 3] = 255;
                }
            if (bps === 16)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        o = off + 2 * i,
                        px = data[o + 1] << 8 | data[o];
                    img[qi] = img[qi + 1] = img[qi + 2] = Math.min(255, ~~(px * scl));
                    img[qi + 3] = 255;
                }
            if (bps === 32)
                for (let i = 0; i < w; i++) {
                    let qi = io + i << 2,
                        o = (off >>> 2) + i,
                        px = f32[o];
                    img[qi] = img[qi + 1] = img[qi + 2] = ~~(0.5 + 255 * px);
                    img[qi + 3] = 255;
                }
        }
    } else if (intp === 2) {
        if (bps === 8) {
            if (smpls === 1)
                for (let i = 0; i < area; i++) {
                    img[4 * i] = img[4 * i + 1] = img[4 * i + 2] = data[i];
                    img[4 * i + 3] = 255;
                }
            if (smpls === 3)
                for (let i = 0; i < area; i++) {
                    let qi = i << 2,
                        ti = i * 3;
                    img[qi] = data[ti];
                    img[qi + 1] = data[ti + 1];
                    img[qi + 2] = data[ti + 2];
                    img[qi + 3] = 255;
                }
            if (smpls >= 4)
                for (let i = 0; i < area; i++) {
                    let qi = i << 2,
                        ti = i * smpls;
                    img[qi] = data[ti];
                    img[qi + 1] = data[ti + 1];
                    img[qi + 2] = data[ti + 2];
                    img[qi + 3] = data[ti + 3];
                }
        } else if (bps === 16) {
            if (smpls === 4)
                for (let i = 0; i < area; i++) {
                    let qi = i << 2,
                        ti = i * 8 + 1;
                    img[qi] = data[ti];
                    img[qi + 1] = data[ti + 2];
                    img[qi + 2] = data[ti + 4];
                    img[qi + 3] = data[ti + 6];
                }
            if (smpls === 3)
                for (let i = 0; i < area; i++) {
                    let qi = i << 2,
                        ti = i * 6 + 1;
                    img[qi] = data[ti];
                    img[qi + 1] = data[ti + 2];
                    img[qi + 2] = data[ti + 4];
                    img[qi + 3] = 255;
                }
        } else if (bps === 32) {
            let ndt = new Float32Array(data.buffer);

            let min = 0;
            for (let i = 0; i < ndt.length; i++) min = Math.min(min, ndt[i]);
            if (min < 0)
                for (let i = 0; i < data.length; i += 4) {
                    let t = data[i];
                    data[i] = data[i + 3];
                    data[i + 3] = t;
                    t = data[i + 1];
                    data[i + 1] = data[i + 2];
                    data[i + 2] = t;
                }

            let pmap = [];
            for (let i = 0; i < 65536; i++) pmap.push(gamma(i / 65535));
            for (let i = 0; i < ndt.length; i++) {
                let cv = Math.max(0, Math.min(1, ndt[i]));
                ndt[i] = pmap[~~(0.5 + cv * 65535)];
            }

            if (smpls === 3)
                for (let i = 0; i < area; i++) {
                    let qi = i << 2,
                        ti = i * 3;
                    img[qi] = ~~(0.5 + ndt[ti] * 255);
                    img[qi + 1] = ~~(0.5 + ndt[ti + 1] * 255);
                    img[qi + 2] = ~~(0.5 + ndt[ti + 2] * 255);
                    img[qi + 3] = 255;
                }
            else if (smpls === 4)
                for (let i = 0; i < area; i++) {
                    let qi = i << 2,
                        ti = i * 4;
                    img[qi] = ~~(0.5 + ndt[ti] * 255);
                    img[qi + 1] = ~~(0.5 + ndt[ti + 1] * 255);
                    img[qi + 2] = ~~(0.5 + ndt[ti + 2] * 255);
                    img[qi + 3] = ~~(0.5 + ndt[ti + 3] * 255);
                }
            else throw smpls;
        } else throw bps;
    } else if (intp === 3) {
        let map = out.t320;
        let cn = 1 << bps;

        let nexta = bps === 8 && smpls > 1 && out.t338 && out.t338[0] !== 0;

        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                let i = y * w + x;
                let qi = i << 2,
                    mi = 0;
                let dof = y * bpl;
                if (false) { } else if (bps === 1) mi = data[dof + (x >>> 3)] >>> 7 - (x & 7) & 1;
                else if (bps === 2) mi = data[dof + (x >>> 2)] >>> 6 - 2 * (x & 3) & 3;
                else if (bps === 4) mi = data[dof + (x >>> 1)] >>> 4 - 4 * (x & 1) & 15;
                else if (bps === 8) mi = data[dof + x * smpls];
                else throw bps;
                img[qi] = map[mi] >> 8;
                img[qi + 1] = map[cn + mi] >> 8;
                img[qi + 2] = map[cn + cn + mi] >> 8;
                img[qi + 3] = nexta ? data[dof + x * smpls + 1] : 255;
            }
    } else if (intp === 5) {
        let gotAlpha = smpls > 4 ? 1 : 0;
        for (let i = 0; i < area; i++) {
            let qi = i << 2,
                si = i * smpls;

            let C = 255 - data[si],
                M = 255 - data[si + 1],
                Y = 255 - data[si + 2],
                K = (255 - data[si + 3]) * (1 / 255);
            img[qi] = ~~(C * K + 0.5);
            img[qi + 1] = ~~(M * K + 0.5);
            img[qi + 2] = ~~(Y * K + 0.5);

            img[qi + 3] = 255 * (1 - gotAlpha) + data[si + 4] * gotAlpha;
        }
    } else if (intp === 6 && out.t278) {
        let rps = out.t278[0];
        for (let y = 0; y < h; y += rps) {
            let i = y * w,
                len = rps * w;

            for (let j = 0; j < len; j++) {
                let qi = 4 * (i + j),
                    si = 3 * i + 4 * (j >>> 1);
                let Y = data[si + (j & 1)],
                    Cb = data[si + 2] - 128,
                    Cr = data[si + 3] - 128;

                let r = Y + ((Cr >> 2) + (Cr >> 3) + (Cr >> 5));
                let g = Y - ((Cb >> 2) + (Cb >> 4) + (Cb >> 5)) - ((Cr >> 1) + (Cr >> 3) + (Cr >> 4) + (Cr >> 5));
                let b = Y + (Cb + (Cb >> 1) + (Cb >> 2) + (Cb >> 6));

                img[qi] = Math.max(0, Math.min(255, r));
                img[qi + 1] = Math.max(0, Math.min(255, g));
                img[qi + 2] = Math.max(0, Math.min(255, b));
                img[qi + 3] = 255;
            }
        }
    } else if (intp === 32845) {
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                let si = (y * w + x) * 6,
                    qi = (y * w + x) * 4;
                let L = data[si + 1] << 8 | data[si];

                L = Math.pow(2, (L + 0.5) / 256 - 64);
                let u = (data[si + 3] + 0.5) / 410;
                let v = (data[si + 5] + 0.5) / 410;

                let sX = 9 * u / (6 * u - 16 * v + 12);
                let sY = 4 * v / (6 * u - 16 * v + 12);
                let bY = L;

                let X = sX * bY / sY,
                    Y = bY,
                    Z = (1 - sX - sY) * bY / sY;

                let r = 2.690 * X - 1.276 * Y - 0.414 * Z;
                let g = -1.022 * X + 1.978 * Y + 0.044 * Z;
                let b = 0.061 * X - 0.224 * Y + 1.163 * Z;

                img[qi] = gamma(Math.min(r, 1)) * 255;
                img[qi + 1] = gamma(Math.min(g, 1)) * 255;
                img[qi + 2] = gamma(Math.min(b, 1)) * 255;
                img[qi + 3] = 255;
            }
    }
    return img;
};

TIFF.binBE = {
    nextZero(data, oldO) {
        let o = oldO;
        while (data[o] !== 0) o++;
        return o;
    },
    readUshort(buff, p) {
        return buff[p] << 8 | buff[p + 1];
    },
    readShort(buff, p) {
        let a = TIFF.binBE.ui8;
        a[0] = buff[p + 1];
        a[1] = buff[p + 0];
        return TIFF.binBE.i16[0];
    },
    readInt(buff, p) {
        let a = TIFF.binBE.ui8;
        a[0] = buff[p + 3];
        a[1] = buff[p + 2];
        a[2] = buff[p + 1];
        a[3] = buff[p + 0];
        return TIFF.binBE.i32[0];
    },
    readUint(buff, p) {
        let a = TIFF.binBE.ui8;
        a[0] = buff[p + 3];
        a[1] = buff[p + 2];
        a[2] = buff[p + 1];
        a[3] = buff[p + 0];
        return TIFF.binBE.ui32[0];
    },
    readASCII(buff, p, l) {
        let s = '';
        for (let i = 0; i < l; i++) s += String.fromCharCode(buff[p + i]);
        return s;
    },
    readFloat(buff, p) {
        let a = TIFF.binBE.ui8;
        for (let i = 0; i < 4; i++) a[i] = buff[p + 3 - i];
        return TIFF.binBE.fl32[0];
    },
    readDouble(buff, p) {
        let a = TIFF.binBE.ui8;
        for (let i = 0; i < 8; i++) a[i] = buff[p + 7 - i];
        return TIFF.binBE.fl64[0];
    },

    writeUshort(buff, p, n) {
        buff[p] = n >> 8 & 255;
        buff[p + 1] = n & 255;
    },
    writeInt(buff, p, n) {
        let a = TIFF.binBE.ui8;
        TIFF.binBE.i32[0] = n;
        buff[p + 3] = a[0];
        buff[p + 2] = a[1];
        buff[p + 1] = a[2];
        buff[p + 0] = a[3];
    },
    writeUint(buff, p, n) {
        buff[p] = n >> 24 & 255;
        buff[p + 1] = n >> 16 & 255;
        buff[p + 2] = n >> 8 & 255;
        buff[p + 3] = n >> 0 & 255;
    },
    writeASCII(buff, p, s) {
        for (let i = 0; i < s.length; i++) buff[p + i] = s.charCodeAt(i);
    },
    writeDouble(buff, p, n) {
        TIFF.binBE.fl64[0] = n;
        for (let i = 0; i < 8; i++) buff[p + i] = TIFF.binBE.ui8[7 - i];
    }
};
TIFF.binBE.ui8 = new Uint8Array(8);
TIFF.binBE.i16 = new Int16Array(TIFF.binBE.ui8.buffer);
TIFF.binBE.i32 = new Int32Array(TIFF.binBE.ui8.buffer);
TIFF.binBE.ui32 = new Uint32Array(TIFF.binBE.ui8.buffer);
TIFF.binBE.fl32 = new Float32Array(TIFF.binBE.ui8.buffer);
TIFF.binBE.fl64 = new Float64Array(TIFF.binBE.ui8.buffer);

TIFF.binLE = {
    nextZero: TIFF.binBE.nextZero,
    readUshort(buff, p) {
        return buff[p + 1] << 8 | buff[p];
    },
    readShort(buff, p) {
        let a = TIFF.binBE.ui8;
        a[0] = buff[p + 0];
        a[1] = buff[p + 1];
        return TIFF.binBE.i16[0];
    },
    readInt(buff, p) {
        let a = TIFF.binBE.ui8;
        a[0] = buff[p + 0];
        a[1] = buff[p + 1];
        a[2] = buff[p + 2];
        a[3] = buff[p + 3];
        return TIFF.binBE.i32[0];
    },
    readUint(buff, p) {
        let a = TIFF.binBE.ui8;
        a[0] = buff[p + 0];
        a[1] = buff[p + 1];
        a[2] = buff[p + 2];
        a[3] = buff[p + 3];
        return TIFF.binBE.ui32[0];
    },
    readASCII: TIFF.binBE.readASCII,
    readFloat(buff, p) {
        let a = TIFF.binBE.ui8;
        for (let i = 0; i < 4; i++) a[i] = buff[p + i];
        return TIFF.binBE.fl32[0];
    },
    readDouble(buff, p) {
        let a = TIFF.binBE.ui8;
        for (let i = 0; i < 8; i++) a[i] = buff[p + i];
        return TIFF.binBE.fl64[0];
    },

    writeUshort(buff, p, n) {
        buff[p] = n & 255;
        buff[p + 1] = n >> 8 & 255;
    },
    writeInt(buff, p, n) {
        let a = TIFF.binBE.ui8;
        TIFF.binBE.i32[0] = n;
        buff[p + 0] = a[0];
        buff[p + 1] = a[1];
        buff[p + 2] = a[2];
        buff[p + 3] = a[3];
    },
    writeUint(buff, p, n) {
        buff[p] = n >>> 0 & 255;
        buff[p + 1] = n >>> 8 & 255;
        buff[p + 2] = n >>> 16 & 255;
        buff[p + 3] = n >>> 24 & 255;
    },
    writeASCII: TIFF.binBE.writeASCII
};

TIFF.copyTile = function utifCopyTile(tb, tw, th, b, w, h, xoff, yoff) {
    let xlim = Math.min(tw, w - xoff);
    let ylim = Math.min(th, h - yoff);
    for (let y = 0; y < ylim; y++) {
        let tof = (yoff + y) * w + xoff;
        let sof = y * tw;
        for (let x = 0; x < xlim; x++) b[tof + x] = tb[sof + x];
    }
};

TIFF.LosslessJpegDecode = (function utifLosslessJpegDecode() {
    let b = null, O = 0;

    function l() {
        return b[O++];
    }

    function m() {
        return b[O++] << 8 | b[O++];
    }

    function z(h, V, I, f) {
        if (h[V + 3] !== 255) return 0;
        if (I === 0) return V;
        for (let w = 0; w < 2; w++) {
            if (h[V + w] === 0) {
                h[V + w] = h.length;
                h.push(0, 0, f, 255);
            }
            let x = z(h, h[V + w], I - 1, f + 1);
            if (x !== 0) return x;
        }
        return 0;
    }

    function a0(h) {
        let V = l(),
            I = [0, 0, 0, 255],
            f = [],
            G = 8;
        for (let w = 0; w < 16; w++) f[w] = l();
        for (let w = 0; w < 16; w++) {
            for (let x = 0; x < f[w]; x++) {
                let T = z(I, 0, w + 1, 1);
                I[T + 3] = l();
            }
        }
        let E = new Uint8Array(1 << G);
        h[V] = [new Uint8Array(I), E];
        for (let w = 0; w < 1 << G; w++) {
            let s = G,
                _ = w,
                Y = 0,
                F = 0;
            while (I[Y + 3] === 255 && s !== 0) {
                F = _ >> --s & 1;
                Y = I[Y + F];
            }
            E[w] = Y;
        }
    }

    function i(h) {
        let V = h.b,
            I = h.f;
        while (V < 25 && h.a < h.d) {
            let f = h.data[h.a++];
            if (f === 255 && !h.c) h.a++;
            I = I << 8 | f;
            V += 8;
        }
        if (V < 0) throw new Error('Error occured while performing lossless JPEG decode');
        h.b = V;
        h.f = I;
    }

    function H(h, V) {
        if (V.b < h) i(V);
        return V.f >> (V.b -= h) & 65535 >> 16 - h;
    }

    function g(h, V) {
        let I = h[0],
            f = 0,
            w = 255,
            x = 0;
        if (V.b < 16) i(V);
        let T = V.f >> V.b - 8 & 255;
        f = h[1][T];
        w = I[f + 3];
        V.b -= I[f + 2];
        while (w === 255) {
            x = V.f >> --V.b & 1;
            f = I[f + x];
            w = I[f + 3];
        }
        return w;
    }

    function P(oldH, V) {
        let h = oldH;
        if (h < 32768 >> 16 - V) h += -(1 << V) + 1;
        return h;
    }

    function a2(h, V) {
        let I = g(h, V);
        if (I === 0) return 0;
        if (I === 16) return -32768;
        let f = H(I, V);
        return P(f, I);
    }

    function X(h, V, I, f, w, x) {
        let T = 0;
        for (let G = 0; G < x; G++) {
            let s = G * V;
            for (let _ = 0; _ < V; _ += w) {
                T++;
                for (let Y = 0; Y < w; Y++) h[s + _ + Y] = a2(f[Y], I);
            }
            if (I.e !== 0 && T % I.e === 0 && G !== 0) {
                let F = I.a,
                    t = I.data;
                while (t[F] !== 255 || !(t[F + 1] >= 208 && t[F + 1] <= 215)) F--;
                I.a = F + 2;
                I.f = 0;
                I.b = 0;
            }
        }
    }

    function o(h, V) {
        return P(H(h, V), h);
    }

    function a1(h, V, I, f, w) {
        let x = b.length - O;
        for (let T = 0; T < x; T += 4) {
            let G = b[O + T];
            b[O + T] = b[O + T + 3];
            b[O + T + 3] = G;
            G = b[O + T + 1];
            b[O + T + 1] = b[O + T + 2];
            b[O + T + 2] = G;
        }
        for (let E = 0; E < w; E++) {
            let s = 32768,
                _ = 32768;
            for (let Y = 0; Y < V; Y += 2) {
                let F = g(f, I),
                    t = g(f, I);
                if (F !== 0) s += o(F, I);
                if (t !== 0) _ += o(t, I);
                h[E * V + Y] = s & 65535;
                h[E * V + Y + 1] = _ & 65535;
            }
        }
    }

    function j(h, V, I, f, w, x, G, E) {
        let s = I * G;
        for (let _ = w; _ < x; _++) h[_] += 1 << E - 1;
        for (let Y = G; Y < s; Y += G)
            for (let _ = w; _ < x; _++) h[Y + _] += h[Y + _ - G];
        for (let F = 1; F < f; F++) {
            let t = F * s;
            for (let _ = w; _ < x; _++) h[t + _] += h[t + _ - s];
            for (let Y = G; Y < s; Y += G) {
                for (let _ = w; _ < x; _++) {
                    let a = t + Y + _,
                        J = a - s,
                        r = h[a - G],
                        Q = 0;
                    if (V === 0) Q = 0;
                    else if (V === 1) Q = r;
                    else if (V === 2) Q = h[J];
                    else if (V === 3) Q = h[J - G];
                    else if (V === 4) Q = r + (h[J] - h[J - G]);
                    else if (V === 5) Q = r + (h[J] - h[J - G] >>> 1);
                    else if (V === 6) Q = h[J] + (r - h[J - G] >>> 1);
                    else if (V === 7) Q = r + h[J] >>> 1;
                    else throw V;
                    h[a] += Q;
                }
            }
        }
    }

    function C(h) {
        b = h;
        O = 0;
        if (m() !== 65496) throw new Error('Error occured while performing lossless JPEG decode');
        let V = [],
            I = 0,
            f = 0,
            w = 0,
            x = [],
            T = [],
            G = [],
            E = 0,
            s = 0,
            _ = 0;

        while (true) {
            let Y = m();
            if (Y === 65535) {
                O--;
                continue;
            }
            let F = m();
            if (Y === 65475) {
                f = l();
                s = m();
                _ = m();
                E = l();
                for (let t = 0; t < E; t++) {
                    let a = l(),
                        J = l(),
                        r = l();
                    if (r !== 0) throw new Error('Error occured while performing lossless JPEG decode');
                    V[a] = [t, J >> 4, J & 15];
                }
            } else if (Y === 65476) {
                let a3 = O + F - 2;
                while (O < a3) a0(T);
            } else if (Y === 65498) {
                O++;
                for (let t = 0; t < E; t++) {
                    let a5 = l(),
                        v = V[a5];
                    G[v[0]] = T[l() >>> 4];
                    x[v[0]] = v.slice(1);
                }
                I = l();
                O += 2;
                break;
            } else if (Y === 65501) {
                w = m();
            } else {
                O += F - 2;
            }
        }
        let a4 = f > 8 ? Uint16Array : Uint8Array,
            $ = new a4(s * _ * E),
            M = {
                b: 0,
                f: 0,
                c: I === 8,
                a: O,
                data: b,
                d: b.length,
                e: w
            };
        if (M.c) a1($, _ * E, M, G[0], s);
        else {
            let c = [],
                p = 0,
                D = 0;
            for (let t = 0; t < E; t++) {
                let N = x[t],
                    S = N[0],
                    K = N[1];
                if (S > p) p = S;
                if (K > D) D = K;
                c.push(S * K);
            }
            if (p !== 1 || D !== 1) {
                if (E !== 3 || c[1] !== 1 || c[2] !== 1) throw new Error('Error occured while parsing');
                if (p !== 2 || D !== 1 && D !== 2) throw new Error('Error occured while parsing');
                let u = [],
                    Z = 0;
                for (let t = 0; t < E; t++) {
                    for (let R = 0; R < c[t]; R++) u.push(G[t]);
                    Z += c[t];
                }
                let B = _ / p,
                    e = s / D,
                    d = B * e;
                X($, B * Z, M, u, Z, e);
                j($, I, B, e, Z - 2, Z, Z, f);
                let A = new Uint16Array(d * c[0]);
                if (p === 2 && D === 2) {
                    for (let t = 0; t < d; t++) {
                        A[4 * t] = $[6 * t];
                        A[4 * t + 1] = $[6 * t + 1];
                        A[4 * t + 2] = $[6 * t + 2];
                        A[4 * t + 3] = $[6 * t + 3];
                    }
                    j(A, I, B * 4, e, 0, 1, 1, f);
                    for (let t = 0; t < d; t++) {
                        $[6 * t] = A[4 * t];
                        $[6 * t + 1] = A[4 * t + 1];
                        $[6 * t + 2] = A[4 * t + 2];
                        $[6 * t + 3] = A[4 * t + 3];
                    }
                }
                if (p === 2 && D === 1) {
                    for (let t = 0; t < d; t++) {
                        A[2 * t] = $[4 * t];
                        A[2 * t + 1] = $[4 * t + 1];
                    }
                    j(A, I, B * 2, e, 0, 1, 1, f);
                    for (let t = 0; t < d; t++) {
                        $[4 * t] = A[2 * t];
                        $[4 * t + 1] = A[2 * t + 1];
                    }
                }
                let n = $.slice(0);
                for (let K = 0; K < s; K++) {
                    if (D === 2)
                        for (let S = 0; S < _; S++) {
                            let q = (K * _ + S) * E,
                                k = ((K >>> 1) * B + (S >>> 1)) * Z,
                                y = (K & 1) * 2 + (S & 1);
                            $[q] = n[k + y];
                            $[q + 1] = n[k + 4];
                            $[q + 2] = n[k + 5];
                        } else
                        for (let S = 0; S < _; S++) {
                            let q = (K * _ + S) * E,
                                k = (K * B + (S >>> 1)) * Z,
                                y = S & 1;
                            $[q] = n[k + y];
                            $[q + 1] = n[k + 2];
                            $[q + 2] = n[k + 3];
                        }
                }
            } else {
                X($, _ * E, M, G, E, s);
                if (w === 0) j($, I, _, s, 0, E, E, f);
                else {
                    let U = Math.floor(w / _);
                    for (let K = 0; K < s; K += U) {
                        let L = $.slice(K * _ * E, (K + U) * _ * E);
                        j(L, I, _, U, 0, E, E, f);
                        $.set(L, K * _ * E);
                    }
                }
            }
        }
        return $;
    }

    return C;
}());

module.exports = TIFF;
