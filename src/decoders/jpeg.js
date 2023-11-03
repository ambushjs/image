const JpegImage = (function jpeg() {
    const dctZigZag = new Int32Array([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);

    const dctCos1 = 4017;
    const dctSin1 = 799;
    const dctCos3 = 3406;
    const dctSin3 = 2276;
    const dctCos6 = 1567;
    const dctSin6 = 3784;
    const dctSqrt2 = 5793;
    const dctSqrt1d2 = 2896;

    let totalBytesAllocated = 0;
    let maxMemoryUsageBytes = 0;

    function constructor() {}

    function buildHuffmanTable(codeLengths, values) {
        const code = [];

        let i = 0;
        let j = 0;
        let k = 0;

        let length = 16;

        while (length > 0 && !codeLengths[length - 1]) {
            length--;
        }

        code.push({ children: [], index: 0 });

        let p = code[0];
        let q = null;

        for (i = 0; i < length; i++) {
            for (j = 0; j < codeLengths[i]; j++) {
                p = code.pop();
                p.children[p.index] = values[k];

                while (p.index > 0) {
                    if (code.length === 0) throw new Error('Could not recreate Huffman Table');
                    p = code.pop();
                }

                p.index++;
                code.push(p);

                while (code.length <= i) {
                    code.push(q = { children: [], index: 0 });
                    p.children[p.index] = q.children;
                    p = q;
                }

                k++;
            }

            if (i + 1 < length) {
                code.push(q = { children: [], index: 0 });
                p.children[p.index] = q.children;
                p = q;
            }
        }

        return code[0].children;
    }

    function decodeScan(data, oldOffset, frame, components, oldResetInterval, spectralStart, spectralEnd, successivePrev, successive, opts) {
        let offset = oldOffset;
        let resetInterval = oldResetInterval;

        const mcusPerLine = frame.mcusPerLine;
        const progressive = frame.progressive;
        const startOffset = offset;

        let bitsData = 0;
        let bitsCount = 0;
        let newOffset = offset;

        function readBit() {
            if (bitsCount > 0) {
                bitsCount--;

                return bitsData >> bitsCount & 1;
            }

            bitsData = data[newOffset++];

            if (bitsData === 0xFF) {
                const nextByte = data[newOffset++];

                if (nextByte) {
                    throw new Error(`unexpected marker: ${(bitsData << 8 | nextByte).toString(16)}`);
                }
            }

            bitsCount = 7;
            return bitsData >>> 7;
        }

        function decodeHuffman(tree) {
            let node = tree;
            let bit = null;

            while ((bit = readBit()) !== null) {
                node = node[bit];
                if (typeof node === 'number') return node;
                if (typeof node !== 'object') throw new Error('invalid huffman sequence');
            }

            return null;
        }

        function receive(length) {
            let n = 0;
            let newLength = length;

            while (newLength > 0) {
                const bit = readBit();

                if (bit === null) return;

                n = n << 1 | bit;
                newLength--;
            }

            return n;
        }

        function receiveAndExtend(length) {
            const n = receive(length);

            if (n >= 1 << length - 1) return n;

            return n + (-1 << length) + 1;
        }
        function decodeBaseline(component, zz) {
            const t = decodeHuffman(component.huffmanTableDC);
            const diff = t === 0 ? 0 : receiveAndExtend(t);

            zz[0] = component.pred = component.pred + diff;

            let k = 1;

            while (k < 64) {
                const rs = decodeHuffman(component.huffmanTableAC);
                const s = rs & 15, r = rs >> 4;

                if (s === 0) {
                    if (r < 15) break;
                    k = k + 16;
                    continue;
                }

                k += r;

                zz[dctZigZag[k]] = receiveAndExtend(s);
                k++;
            }
        }

        function decodeDCFirst(component, zz) {
            const t = decodeHuffman(component.huffmanTableDC);
            const diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
            zz[0] = component.pred = component.pred + diff;
        }

        function decodeDCSuccessive(component, zz) {
            zz[0] = zz[0] | readBit() << successive;
        }

        let eobrun = 0;

        function decodeACFirst(component, zz) {
            if (eobrun > 0) {
                eobrun--;
                return;
            }
            let k = spectralStart, e = spectralEnd;
            while (k <= e) {
                const rs = decodeHuffman(component.huffmanTableAC);
                const s = rs & 15, r = rs >> 4;
                if (s === 0) {
                    if (r < 15) {
                        eobrun = receive(r) + (1 << r) - 1;
                        break;
                    }
                    k = k + 16;
                    continue;
                }
                k = k + r;
                const z = dctZigZag[k];
                zz[z] = receiveAndExtend(s) * (1 << successive);
                k++;
            }
        }

        let successiveACState = 0;
        let successiveACNextValue = 0;

        function decodeACSuccessive(component, zz) {
            const e = spectralEnd;
            let k = spectralStart;
            let r = 0;
            let rs = null;
            let s = 0;
            let r1 = 0;

            while (k <= e) {
                const z = dctZigZag[k];
                const direction = zz[z] < 0 ? -1 : 1;
                switch (successiveACState) {
                case 0:
                    rs = decodeHuffman(component.huffmanTableAC);

                    s = rs & 15;
                    r1 = rs >> 4;

                    if (s === 0) {
                        if (r1 < 15) {
                            eobrun = receive(r1) + (1 << r1);
                            successiveACState = 4;
                        } else {
                            r1 = 16;
                            successiveACState = 1;
                        }
                    } else {
                        if (s !== 1)
                            throw new Error('invalid ACn encoding');
                        successiveACNextValue = receiveAndExtend(s);
                        successiveACState = r1 ? 2 : 3;
                    }
                    continue;
                case 1:
                case 2:
                    if (zz[z])
                        zz[z] += (readBit() << successive) * direction;
                    else {
                        r--;
                        if (r === 0)
                            successiveACState = successiveACState === 2 ? 3 : 0;
                    }
                    break;
                case 3:
                    if (zz[z])
                        zz[z] += (readBit() << successive) * direction;
                    else {
                        zz[z] = successiveACNextValue << successive;
                        successiveACState = 0;
                    }
                    break;
                case 4:
                    if (zz[z]) zz[z] += (readBit() << successive) * direction;
                    break;
                }

                k++;
            }
            if (successiveACState === 4) {
                eobrun--;
                if (eobrun === 0) successiveACState = 0;
            }
        }
        function decodeMcu(component, newDecode, mcu, row, col) {
            const mcuRow = mcu / mcusPerLine | 0;
            const mcuCol = mcu % mcusPerLine;
            let blockRow = mcuRow * component.v + row;
            let blockCol = mcuCol * component.h + col;

            if (component.blocks[blockRow] === undefined && opts.tolerantDecoding) return;

            newDecode(component, component.blocks[blockRow][blockCol]);
        }
        function decodeBlock(component, newDecode, mcu) {
            const blockRow = mcu / component.blocksPerLine | 0;
            const blockCol = mcu % component.blocksPerLine;

            if (component.blocks[blockRow] === undefined && opts.tolerantDecoding) return;

            newDecode(component, component.blocks[blockRow][blockCol]);
        }

        const componentsLength = components.length;
        let component = null;
        let decodeFn = null;

        let i = 0;
        let j = 0;
        let k = 0;
        let n = 0;

        if (progressive) spectralStart === 0 ? decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive : decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
        else decodeFn = decodeBaseline;

        let mcu = 0;
        let marker = 0;
        let mcuExpected = 0;

        componentsLength === 1 ? mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn : mcuExpected = mcusPerLine * frame.mcusPerColumn;

        if (!resetInterval) resetInterval = mcuExpected;

        let h = 0;
        let v = 0;

        while (mcu < mcuExpected) {
            for (i = 0; i < componentsLength; i++)
                components[i].pred = 0;
            eobrun = 0;

            if (componentsLength === 1) {
                component = components[0];
                for (n = 0; n < resetInterval; n++) {
                    decodeBlock(component, decodeFn, mcu);
                    mcu++;
                }
            } else {
                for (n = 0; n < resetInterval; n++) {
                    for (i = 0; i < componentsLength; i++) {
                        component = components[i];
                        h = component.h;
                        v = component.v;
                        for (j = 0; j < v; j++) {
                            for (k = 0; k < h; k++) {
                                decodeMcu(component, decodeFn, mcu, j, k);
                            }
                        }
                    }
                    mcu++;

                    if (mcu === mcuExpected) break;
                }
            }

            if (mcu === mcuExpected) {
                do {
                    if (data[offset] === 0xFF) {
                        if (data[offset + 1] !== 0x00) {
                            break;
                        }
                    }
                    offset += 1;
                } while (offset < data.length - 2);
            }

            bitsCount = 0;
            marker = data[offset] << 8 | data[offset + 1];
            if (marker < 0xFF00) {
                throw new Error('marker was not found');
            }

            if (marker >= 0xFFD0 && marker <= 0xFFD7) {
                offset += 2;
            } else
                break;
        }

        return offset - startOffset;
    }

    function requestMemoryAllocation(increaseAmount = 0) {
        const totalMemoryImpactBytes = totalBytesAllocated + increaseAmount;
        if (totalMemoryImpactBytes > maxMemoryUsageBytes) {
            const exceededAmount = Math.ceil((totalMemoryImpactBytes - maxMemoryUsageBytes) / 1024 / 1024);
            throw new Error(`maxMemoryUsageInMB limit exceeded by at least ${exceededAmount}MB`);
        }

        totalBytesAllocated = totalMemoryImpactBytes;
    }

    function buildComponentData(frame, component) {
        const lines = [];
        const blocksPerLine = component.blocksPerLine;
        const blocksPerColumn = component.blocksPerColumn;
        const samplesPerLine = blocksPerLine << 3;

        const R = new Int32Array(64), r = new Uint8Array(64);

        function quantizeAndInverse(zz, dataOut, dataIn) {
            const qt = component.quantizationTable;

            let v0 = 0;
            let v1 = 0;
            let v2 = 0;
            let v3 = 0;
            let v4 = 0;
            let v5 = 0;
            let v6 = 0;
            let v7 = 0;

            let t = 0;
            const p = dataIn;
            let i = 0;

            for (i = 0; i < 64; i++)
                p[i] = zz[i] * qt[i];

            for (i = 0; i < 8; ++i) {
                const row = 8 * i;

                if (p[1 + row] === 0 && p[2 + row] === 0 && p[3 + row] === 0 &&
                    p[4 + row] === 0 && p[5 + row] === 0 && p[6 + row] === 0 &&
                    p[7 + row] === 0) {
                    t = dctSqrt2 * p[0 + row] + 512 >> 10;
                    p[0 + row] = t;
                    p[1 + row] = t;
                    p[2 + row] = t;
                    p[3 + row] = t;
                    p[4 + row] = t;
                    p[5 + row] = t;
                    p[6 + row] = t;
                    p[7 + row] = t;
                    continue;
                }

                v0 = dctSqrt2 * p[0 + row] + 128 >> 8;
                v1 = dctSqrt2 * p[4 + row] + 128 >> 8;
                v2 = p[2 + row];
                v3 = p[6 + row];
                v4 = dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128 >> 8;
                v7 = dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128 >> 8;
                v5 = p[3 + row] << 4;
                v6 = p[5 + row] << 4;

                t = v0 - v1 + 1 >> 1;
                v0 = v0 + v1 + 1 >> 1;
                v1 = t;
                t = v2 * dctSin6 + v3 * dctCos6 + 128 >> 8;
                v2 = v2 * dctCos6 - v3 * dctSin6 + 128 >> 8;
                v3 = t;
                t = v4 - v6 + 1 >> 1;
                v4 = v4 + v6 + 1 >> 1;
                v6 = t;
                t = v7 + v5 + 1 >> 1;
                v5 = v7 - v5 + 1 >> 1;
                v7 = t;

                t = v0 - v3 + 1 >> 1;
                v0 = v0 + v3 + 1 >> 1;
                v3 = t;
                t = v1 - v2 + 1 >> 1;
                v1 = v1 + v2 + 1 >> 1;
                v2 = t;
                t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
                v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
                v7 = t;
                t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
                v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
                v6 = t;

                p[0 + row] = v0 + v7;
                p[7 + row] = v0 - v7;
                p[1 + row] = v1 + v6;
                p[6 + row] = v1 - v6;
                p[2 + row] = v2 + v5;
                p[5 + row] = v2 - v5;
                p[3 + row] = v3 + v4;
                p[4 + row] = v3 - v4;
            }

            for (i = 0; i < 8; ++i) {
                const col = i;

                if (p[1 * 8 + col] === 0 && p[2 * 8 + col] === 0 && p[3 * 8 + col] === 0 && p[4 * 8 + col] === 0 && p[5 * 8 + col] === 0 && p[6 * 8 + col] === 0 && p[7 * 8 + col] === 0) {
                    t = dctSqrt2 * dataIn[i + 0] + 8192 >> 14;
                    p[0 * 8 + col] = t;
                    p[1 * 8 + col] = t;
                    p[2 * 8 + col] = t;
                    p[3 * 8 + col] = t;
                    p[4 * 8 + col] = t;
                    p[5 * 8 + col] = t;
                    p[6 * 8 + col] = t;
                    p[7 * 8 + col] = t;

                    continue;
                }

                v0 = dctSqrt2 * p[0 * 8 + col] + 2048 >> 12;
                v1 = dctSqrt2 * p[4 * 8 + col] + 2048 >> 12;
                v2 = p[2 * 8 + col];
                v3 = p[6 * 8 + col];
                v4 = dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048 >> 12;
                v7 = dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048 >> 12;
                v5 = p[3 * 8 + col];
                v6 = p[5 * 8 + col];

                t = v0 - v1 + 1 >> 1;
                v0 = v0 + v1 + 1 >> 1;
                v1 = t;
                t = v2 * dctSin6 + v3 * dctCos6 + 2048 >> 12;
                v2 = v2 * dctCos6 - v3 * dctSin6 + 2048 >> 12;
                v3 = t;
                t = v4 - v6 + 1 >> 1;
                v4 = v4 + v6 + 1 >> 1;
                v6 = t;
                t = v7 + v5 + 1 >> 1;
                v5 = v7 - v5 + 1 >> 1;
                v7 = t;

                t = v0 - v3 + 1 >> 1;
                v0 = v0 + v3 + 1 >> 1;
                v3 = t;
                t = v1 - v2 + 1 >> 1;
                v1 = v1 + v2 + 1 >> 1;
                v2 = t;
                t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
                v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
                v7 = t;
                t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
                v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
                v6 = t;

                p[0 * 8 + col] = v0 + v7;
                p[7 * 8 + col] = v0 - v7;
                p[1 * 8 + col] = v1 + v6;
                p[6 * 8 + col] = v1 - v6;
                p[2 * 8 + col] = v2 + v5;
                p[5 * 8 + col] = v2 - v5;
                p[3 * 8 + col] = v3 + v4;
                p[4 * 8 + col] = v3 - v4;
            }

            for (i = 0; i < 64; ++i) {
                const sample = 128 + (p[i] + 8 >> 4);

                if (sample < 0) dataOut[i] = 0;
                else if (sample > 0xFF) dataOut[i] = 0xFF;
                else dataOut[i] = sample;
            }
        }

        requestMemoryAllocation(samplesPerLine * blocksPerColumn * 8);

        let i = 0;
        let j = 0;

        for (let blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
            const scanLine = blockRow << 3;

            for (i = 0; i < 8; i++) {
                lines.push(new Uint8Array(samplesPerLine));
            }

            for (let blockCol = 0; blockCol < blocksPerLine; blockCol++) {
                quantizeAndInverse(component.blocks[blockRow][blockCol], r, R);

                let offset = 0;
                const sample = blockCol << 3;

                for (j = 0; j < 8; j++) {
                    const line = lines[scanLine + j];

                    for (i = 0; i < 8; i++) {
                        line[sample + i] = r[offset++];
                    }
                }
            }
        }

        return lines;
    }

    function clampTo8bit(a) {
        if (a < 0) return 0;
        else if (a > 255) return 255;
        else return a;
    }

    constructor.prototype = {
        load: function load(path) {
            const xhr = new XMLHttpRequest();

            xhr.open('GET', path, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function onload() {
                this.parse(new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer));

                if (this.onload) this.onload();
            }.bind(this);

            xhr.send(null);
        },
        parse: function parse(data) {
            const maxResolutionInPixels = this.opts.maxResolutionInMP * 1000 * 1000;

            let offset = 0;

            function readUint16() {
                const value = data[offset] << 8 | data[offset + 1];
                offset += 2;
                return value;
            }

            function readDataBlock() {
                const length = readUint16();
                const array = data.subarray(offset, offset + length - 2);

                offset += array.length;

                return array;
            }

            function prepareComponents(frame) {
                let maxH = 1;
                let maxV = 1;
                let component = null;
                let componentId = null;

                for (componentId in frame.components) {
                    if (Object.prototype.hasOwnProperty.call(frame.components, componentId)) {
                        component = frame.components[componentId];
                        if (maxH < component.h) maxH = component.h;
                        if (maxV < component.v) maxV = component.v;
                    }
                }

                const mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / maxH);
                const mcusPerColumn = Math.ceil(frame.scanLines / 8 / maxV);

                for (componentId in frame.components) {
                    if (Object.prototype.hasOwnProperty.call(frame.components, componentId)) {
                        component = frame.components[componentId];
                        const blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / maxH);
                        const blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * component.v / maxV);
                        const blocksPerLineForMcu = mcusPerLine * component.h;
                        const blocksPerColumnForMcu = mcusPerColumn * component.v;
                        const blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;
                        const blocks = [];

                        requestMemoryAllocation(blocksToAllocate * 256);

                        for (let i = 0; i < blocksPerColumnForMcu; i++) {
                            const row = [];

                            for (let j = 0; j < blocksPerLineForMcu; j++) {
                                row.push(new Int32Array(64));
                            }

                            blocks.push(row);
                        }

                        component.blocksPerLine = blocksPerLine;
                        component.blocksPerColumn = blocksPerColumn;
                        component.blocks = blocks;
                    }
                }

                frame.maxH = maxH;
                frame.maxV = maxV;
                frame.mcusPerLine = mcusPerLine;
                frame.mcusPerColumn = mcusPerColumn;
            }

            const frame = {};
            const frames = [];
            const quantizationTables = [];
            const huffmanTablesAC = [];
            const huffmanTablesDC = [];

            let jfif = null;
            let adobe = null;
            let resetInterval = null;
            let fileMarker = readUint16();
            let malformedDataOffset = -1;

            let appData = null;
            let components = [];
            let selectorsCount = null;
            let spectralStart = null;
            let spectralEnd = null;
            let successiveApproximation = null;
            let processed = null;
            let componentCounts = 0;
            let quantizationTablesLength = null;
            let quantizationTablesEnd = null;
            let huffmanLength = null;

            this.comments = [];

            if (fileMarker !== 0xFFD8) {
                throw new Error('SOI not found');
            }

            fileMarker = readUint16();

            while (fileMarker !== 0xFFD9) {
                switch (fileMarker) {
                case 0xFF00: break;
                case 0xFFE0:
                case 0xFFE1:
                case 0xFFE2:
                case 0xFFE3:
                case 0xFFE4:
                case 0xFFE5:
                case 0xFFE6:
                case 0xFFE7:
                case 0xFFE8:
                case 0xFFE9:
                case 0xFFEA:
                case 0xFFEB:
                case 0xFFEC:
                case 0xFFED:
                case 0xFFEE:
                case 0xFFEF:
                case 0xFFFE:
                    appData = readDataBlock();

                    if (fileMarker === 0xFFFE) {
                        const comment = String.fromCharCode.apply(null, appData);
                        this.comments.push(comment);
                    }

                    if (fileMarker === 0xFFE0) {
                        if (appData[0] === 0x4A && appData[1] === 0x46 && appData[2] === 0x49 && appData[3] === 0x46 && appData[4] === 0) {
                            jfif = {
                                version: { major: appData[5], minor: appData[6] },
                                densityUnits: appData[7],
                                xDensity: appData[8] << 8 | appData[9],
                                yDensity: appData[10] << 8 | appData[11],
                                thumbWidth: appData[12],
                                thumbHeight: appData[13],
                                thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
                            };
                        }
                    }

                    if (fileMarker === 0xFFEE) {
                        if (appData[0] === 0x41 && appData[1] === 0x64 && appData[2] === 0x6F && appData[3] === 0x62 && appData[4] === 0x65 && appData[5] === 0) {
                            adobe = {
                                version: appData[6],
                                flags0: appData[7] << 8 | appData[8],
                                flags1: appData[9] << 8 | appData[10],
                                transformCode: appData[11]
                            };
                        }
                    }

                    break;

                case 0xFFDB:
                    quantizationTablesLength = readUint16();
                    quantizationTablesEnd = quantizationTablesLength + offset - 2;

                    while (offset < quantizationTablesEnd) {
                        const quantizationTableSpec = data[offset++];

                        requestMemoryAllocation(64 * 4);

                        const tableData = new Int32Array(64);

                        if (quantizationTableSpec >> 4 === 0) {
                            for (let j = 0; j < 64; j++) {
                                const z1 = dctZigZag[j];
                                tableData[z1] = data[offset++];
                            }
                        } else if (quantizationTableSpec >> 4 === 1) {
                            for (let j = 0; j < 64; j++) {
                                const z2 = dctZigZag[j];
                                tableData[z2] = readUint16();
                            }
                        } else throw new Error('DQT: invalid table spec');

                        quantizationTables[quantizationTableSpec & 15] = tableData;
                    }

                    break;

                case 0xFFC0:
                case 0xFFC1:
                case 0xFFC2:
                    readUint16();

                    frame.extended = fileMarker === 0xFFC1;
                    frame.progressive = fileMarker === 0xFFC2;
                    frame.precision = data[offset++];
                    frame.scanLines = readUint16();
                    frame.samplesPerLine = readUint16();
                    frame.components = {};
                    frame.componentsOrder = [];

                    componentCounts = data[offset++];

                    if (frame.scanLines * frame.samplesPerLine > maxResolutionInPixels) {
                        const exceededAmount = Math.ceil((frame.scanLines * frame.samplesPerLine - maxResolutionInPixels) / 1e6);
                        throw new Error(`maxResolutionInMP limit exceeded by ${exceededAmount}MP`);
                    }

                    for (let i = 0; i < componentCounts; i++) {
                        const componentId = data[offset];
                        const h = data[offset + 1] >> 4;
                        const v = data[offset + 1] & 15;
                        const qId = data[offset + 2];

                        if (h <= 0 || v <= 0) {
                            throw new Error('Invalid sampling factor, expected values above 0');
                        }

                        frame.componentsOrder.push(componentId);
                        frame.components[componentId] = { h, v, quantizationIdx: qId };

                        offset += 3;
                    }

                    prepareComponents(frame);
                    frames.push(frame);

                    break;

                case 0xFFC4:
                    huffmanLength = readUint16();
                    for (let i = 2; i < huffmanLength;) {
                        const huffmanTableSpec = data[offset++];
                        const codeLengths = new Uint8Array(16);

                        let codeLengthSum = 0;

                        for (let j = 0; j < 16; j++, offset++) {
                            codeLengthSum = codeLengthSum + (codeLengths[j] = data[offset]);
                        }

                        requestMemoryAllocation(16 + codeLengthSum);
                        const huffmanValues = new Uint8Array(codeLengthSum);

                        for (let j = 0; j < codeLengthSum; j++, offset++) {
                            huffmanValues[j] = data[offset];
                        }

                        i = i + (17 + codeLengthSum);

                        (huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] = buildHuffmanTable(codeLengths, huffmanValues);
                    }

                    break;

                case 0xFFDD:
                    readUint16();
                    resetInterval = readUint16();

                    break;

                case 0xFFDC:
                    readUint16();
                    readUint16();

                    break;

                case 0xFFDA:
                    readUint16();

                    selectorsCount = data[offset++];

                    for (let i = 0; i < selectorsCount; i++) {
                        const component = frame.components[data[offset++]];
                        const tableSpec = data[offset++];

                        component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
                        component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
                        components.push(component);
                    }

                    spectralStart = data[offset++];
                    spectralEnd = data[offset++];
                    successiveApproximation = data[offset++];
                    processed = decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successiveApproximation >> 4, successiveApproximation & 15, this.opts);
                    offset += processed;

                    break;

                case 0xFFFF:
                    if (data[offset] !== 0xFF) offset--;

                    break;
                default:
                    if (data[offset - 3] === 0xFF && data[offset - 2] >= 0xC0 && data[offset - 2] <= 0xFE) {
                        offset -= 3;
                        break;
                    } else if (fileMarker === 0xE0 || fileMarker === 0xE1) {
                        if (malformedDataOffset !== -1) {
                            throw new Error(`first unknown JPEG marker at offset ${malformedDataOffset.toString(16)}, second unknown JPEG marker ${fileMarker.toString(16)} at offset ${(offset - 1).toString(16)}`);
                        }

                        malformedDataOffset = offset - 1;

                        const nextOffset = readUint16();

                        if (data[offset + nextOffset - 2] === 0xFF) {
                            offset += nextOffset - 2;
                            break;
                        }
                    }

                    throw new Error(`unknown JPEG marker ${fileMarker.toString(16)}`);
                }

                fileMarker = readUint16();
            }

            if (frames.length !== 1) throw new Error('only single frame JPEGs supported');

            for (let i = 0; i < frames.length; i++) {
                const cp = frames[i].components;
                for (const j in cp) {
                    if (Object.prototype.hasOwnProperty.call(cp, j)) {
                        cp[j].quantizationTable = quantizationTables[cp[j].quantizationIdx];
                        delete cp[j].quantizationIdx;
                    }
                }
            }

            this.width = frame.samplesPerLine;
            this.height = frame.scanLines;
            this.jfif = jfif;
            this.adobe = adobe;
            this.components = [];

            for (let i = 0; i < frame.componentsOrder.length; i++) {
                const component = frame.components[frame.componentsOrder[i]];
                this.components.push({
                    lines: buildComponentData(frame, component),
                    scaleX: component.h / frame.maxH,
                    scaleY: component.v / frame.maxV
                });
            }
        },
        getData: function getData(width, height) {
            const scaleX = this.width / width, scaleY = this.height / height;
            const dataLength = width * height * this.components.length;

            let component1 = null;
            let component2 = null;
            let component3 = null;
            let component4 = null;
            let component1Line = null;
            let component2Line = null;
            let component3Line = null;
            let component4Line = null;
            let x = 0;
            let y = 0;
            let offset = 0;
            let Y = null;
            let Cb = null;
            let Cr = null;
            let K = null;
            let C = null;
            let M = null;
            let Ye = null;
            let R = null;
            let G = null;
            let B = null;
            let colorTransform = null;

            requestMemoryAllocation(dataLength);

            const data = new Uint8Array(dataLength);

            switch (this.components.length) {
            case 1:
                component1 = this.components[0];
                for (y = 0; y < height; y++) {
                    component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                    for (x = 0; x < width; x++) {
                        Y = component1Line[0 | x * component1.scaleX * scaleX];

                        data[offset++] = Y;
                    }
                }
                break;
            case 2:
                component1 = this.components[0];
                component2 = this.components[1];
                for (y = 0; y < height; y++) {
                    component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                    component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
                    for (x = 0; x < width; x++) {
                        Y = component1Line[0 | x * component1.scaleX * scaleX];
                        data[offset++] = Y;
                        Y = component2Line[0 | x * component2.scaleX * scaleX];
                        data[offset++] = Y;
                    }
                }
                break;
            case 3:
                colorTransform = true;

                if (this.adobe && this.adobe.transformCode) colorTransform = true;
                else if (typeof this.opts.colorTransform !== 'undefined') colorTransform = Boolean(this.opts.colorTransform);

                component1 = this.components[0];
                component2 = this.components[1];
                component3 = this.components[2];

                for (y = 0; y < height; y++) {
                    component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                    component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
                    component3Line = component3.lines[0 | y * component3.scaleY * scaleY];

                    for (x = 0; x < width; x++) {
                        if (!colorTransform) {
                            R = component1Line[0 | x * component1.scaleX * scaleX];
                            G = component2Line[0 | x * component2.scaleX * scaleX];
                            B = component3Line[0 | x * component3.scaleX * scaleX];
                        } else {
                            Y = component1Line[0 | x * component1.scaleX * scaleX];
                            Cb = component2Line[0 | x * component2.scaleX * scaleX];
                            Cr = component3Line[0 | x * component3.scaleX * scaleX];

                            R = clampTo8bit(Y + 1.402 * (Cr - 128));
                            G = clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                            B = clampTo8bit(Y + 1.772 * (Cb - 128));
                        }

                        data[offset++] = R;
                        data[offset++] = G;
                        data[offset++] = B;
                    }
                }

                break;
            case 4:
                if (!this.adobe) throw new Error('Unsupported color mode (4 components)');

                colorTransform = false;

                if (this.adobe && this.adobe.transformCode) colorTransform = true;
                else if (typeof this.opts.colorTransform !== 'undefined') colorTransform = Boolean(this.opts.colorTransform);

                component1 = this.components[0];
                component2 = this.components[1];
                component3 = this.components[2];
                component4 = this.components[3];

                for (y = 0; y < height; y++) {
                    component1Line = component1.lines[0 | y * component1.scaleY * scaleY];
                    component2Line = component2.lines[0 | y * component2.scaleY * scaleY];
                    component3Line = component3.lines[0 | y * component3.scaleY * scaleY];
                    component4Line = component4.lines[0 | y * component4.scaleY * scaleY];

                    for (x = 0; x < width; x++) {
                        if (!colorTransform) {
                            C = component1Line[0 | x * component1.scaleX * scaleX];
                            M = component2Line[0 | x * component2.scaleX * scaleX];
                            Ye = component3Line[0 | x * component3.scaleX * scaleX];
                            K = component4Line[0 | x * component4.scaleX * scaleX];
                        } else {
                            Y = component1Line[0 | x * component1.scaleX * scaleX];
                            Cb = component2Line[0 | x * component2.scaleX * scaleX];
                            Cr = component3Line[0 | x * component3.scaleX * scaleX];
                            K = component4Line[0 | x * component4.scaleX * scaleX];

                            C = 255 - clampTo8bit(Y + 1.402 * (Cr - 128));
                            M = 255 - clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                            Ye = 255 - clampTo8bit(Y + 1.772 * (Cb - 128));
                        }

                        data[offset++] = 255 - C;
                        data[offset++] = 255 - M;
                        data[offset++] = 255 - Ye;
                        data[offset++] = 255 - K;
                    }
                }

                break;
            default:
                throw new Error('Unsupported color mode');
            }

            return data;
        },
        copyToImageData: function copyToImageData(imageData, formatAsRGBA) {
            const width = imageData.width, height = imageData.height;
            const imageDataArray = imageData.data;
            const data = this.getData(width, height);

            let i = 0;
            let j = 0;
            let x = 0;
            let y = 0;
            let Y = null;
            let K = null;
            let C = null;
            let M = null;
            let R = null;
            let G = null;
            let B = null;

            switch (this.components.length) {
            case 1:
                for (y = 0; y < height; y++) {
                    for (x = 0; x < width; x++) {
                        Y = data[i++];

                        imageDataArray[j++] = Y;
                        imageDataArray[j++] = Y;
                        imageDataArray[j++] = Y;

                        if (formatAsRGBA) {
                            imageDataArray[j++] = 255;
                        }
                    }
                }

                break;
            case 3:
                for (y = 0; y < height; y++) {
                    for (x = 0; x < width; x++) {
                        R = data[i++];
                        G = data[i++];
                        B = data[i++];

                        imageDataArray[j++] = R;
                        imageDataArray[j++] = G;
                        imageDataArray[j++] = B;

                        if (formatAsRGBA) {
                            imageDataArray[j++] = 255;
                        }
                    }
                }

                break;
            case 4:
                for (y = 0; y < height; y++) {
                    for (x = 0; x < width; x++) {
                        C = data[i++];
                        M = data[i++];
                        Y = data[i++];
                        K = data[i++];

                        R = 255 - clampTo8bit(C * (1 - K / 255) + K);
                        G = 255 - clampTo8bit(M * (1 - K / 255) + K);
                        B = 255 - clampTo8bit(Y * (1 - K / 255) + K);

                        imageDataArray[j++] = R;
                        imageDataArray[j++] = G;
                        imageDataArray[j++] = B;

                        if (formatAsRGBA) {
                            imageDataArray[j++] = 255;
                        }
                    }
                }

                break;
            default:
                throw new Error('Unsupported color mode');
            }
        }
    };

    constructor.resetMaxMemoryUsage = function resetMemoryUsage(maxMemoryUsageBytes_) {
        totalBytesAllocated = 0;
        maxMemoryUsageBytes = maxMemoryUsageBytes_;
    };

    constructor.getBytesAllocated = function getBytes() {
        return totalBytesAllocated;
    };

    constructor.requestMemoryAllocation = requestMemoryAllocation;

    return constructor;
}());

module.exports = function decode(data) {
    const opts = {
        formatAsRGBA: true,
        tolerantDecoding: true,
        maxResolutionInMP: 100,
        maxMemoryUsageInMB: 512,
    };

    const decoder = new JpegImage();

    decoder.opts = opts;
    JpegImage.resetMaxMemoryUsage(opts.maxMemoryUsageInMB * 1024 * 1024);
    decoder.parse(new Uint8Array(data));

    const bytesNeeded = decoder.width * decoder.height * (opts.formatAsRGBA ? 4 : 3);

    JpegImage.requestMemoryAllocation(bytesNeeded);

    const image = {
        width: decoder.width,
        height: decoder.height,
        data: Buffer.alloc(bytesNeeded),
        format: 'jpeg',
        ...decoder.comments.length > 0 && { comments: decoder.comments },
    };

    decoder.copyToImageData(image, opts.formatAsRGBA);

    return image;
};
