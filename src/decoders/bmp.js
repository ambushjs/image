

class BmpDecoder {
    constructor(buffer, alpha) {
        this.pos = 0;
        this.buffer = buffer;
        this.isWithAlpha = Boolean(alpha);
        this.bottomUp = !0;
        this.flag = this.buffer.toString('utf-8', 0, this.pos += 2);
        this.format = 'bmp';

        this.parseHeader();
        this.parseRGBA();
    }

    parseHeader() {
        this.pos += 16;

        this.width = this.buffer.readUInt32LE(this.pos); this.pos += 4;
        this.height = this.buffer.readInt32LE(this.pos); this.pos += 4; this.pos += 2;
        this.bitPP = this.buffer.readUInt16LE(this.pos); this.pos += 2;
        this.compress = this.buffer.readUInt32LE(this.pos); this.pos += 4; this.pos += 12;
        this.colors = this.buffer.readUInt32LE(this.pos); this.pos += 4; this.pos += 4;

        if (this.bitPP === 16 && this.isWithAlpha) {
            const size = this.colors === 0 ? 1 << this.bitPP : this.colors;

            this.palette = Array(size);

            for (let i = 0; i < size; i++) {
                this.palette[i] = {
                    red: this.buffer.readUInt8(this.pos++),
                    green: this.buffer.readUInt8(this.pos++),
                    blue: this.buffer.readUInt8(this.pos++),
                    quad: this.buffer.readUInt8(this.pos++),
                };
            }
        }

        this.height < 0 && (this.height = -1 * this.height, this.bottomUp = !1);
    }

    parseRGBA() {
        this.data = Buffer.alloc(this.width * this.height * 4), this[`bit${this.bitPP}`]();
    }

    bit1() {
        const bytesPerRow = Math.ceil(this.width / 8);
        const padding = bytesPerRow % 4;

        let rowIndex = this.height >= 0 ? this.height - 1 : -this.height;

        for (let pixelRow = this.height - 1; pixelRow >= 0; pixelRow--) {
            rowIndex = this.bottomUp ? pixelRow : this.height - 1 - pixelRow;

            for (let byteIndex = 0; byteIndex < bytesPerRow; byteIndex++) {
                const byteValue = this.buffer.readUInt8(this.pos++);
                const pixelOffset = rowIndex * this.width * 4 + 32 * byteIndex;

                for (let bit = 0; bit < 8; bit++) {
                    if (8 * byteIndex + bit < this.width) {
                        const paletteIndex = byteValue >> 7 - bit & 1;
                        const paletteEntry = this.palette[paletteIndex];

                        this.data[pixelOffset + 4 * bit] = 0;
                        this.data[pixelOffset + 4 * bit + 1] = paletteEntry.blue;
                        this.data[pixelOffset + 4 * bit + 2] = paletteEntry.green;
                        this.data[pixelOffset + 4 * bit + 3] = paletteEntry.red;
                    } else break;
                }
            }

            if (padding !== 0) this.pos += 4 - padding;
        }
    }

    bit4() {
        if (this.compress === 2) {
            this.data.fill(255);

            for (let dataIndex = 0, rowIndex = this.bottomUp ? this.height - 1 : 0, oddFlag = false; dataIndex < this.data.length;) {
                function processNibble(nibble) {
                    const paletteEntry = this.palette[nibble];

                    this.data[dataIndex] = 0;
                    this.data[dataIndex + 1] = paletteEntry.blue;
                    this.data[dataIndex + 2] = paletteEntry.green;
                    this.data[dataIndex + 3] = paletteEntry.red;

                    dataIndex += 4;
                }

                let pixelValue = this.buffer.readUInt8(this.pos++);

                if (pixelValue === 2) {
                    let runLength = this.buffer.readUInt8(this.pos++);

                    if (runLength === 0) {
                        this.bottomUp ? rowIndex-- : rowIndex++;

                        dataIndex = rowIndex * this.width * 4;
                        oddFlag = false;

                        continue;
                    }

                    if (runLength === 1) break;
                    if (runLength === 1) {
                        const yOffset = this.buffer.readUInt8(this.pos++);
                        const xOffset = this.buffer.readUInt8(this.pos++);

                        this.bottomUp ? rowIndex -= yOffset : rowIndex += yOffset;

                        dataIndex += yOffset * this.width * 4 + 4 * xOffset;
                    } else {
                        for (let nibbleValue = this.buffer.readUInt8(this.pos++), nibbleIndex = 0; nibbleIndex < runLength; nibbleIndex++) {
                            oddFlag ? processNibble.call(this, 15 & nibbleValue) : processNibble.call(this, (240 & nibbleValue) >> 4);

                            if (1 & nibbleIndex && nibbleIndex + 1 < runLength) nibbleValue = this.buffer.readUInt8(this.pos++);

                            oddFlag = !oddFlag;
                        }

                        if ((runLength + 1 >> 1 & 1) === 1) this.pos++;
                    }
                } else {
                    for (let nibbleIndex = 0; nibbleIndex < pixelValue; nibbleIndex++) {
                        oddFlag ? processNibble.call(this, 15 & pixelValue) : processNibble.call(this, (240 & pixelValue) >> 4);
                        oddFlag = !oddFlag;
                    }
                }
            }
        } else {
            for (let rowByteCount = Math.ceil(this.width / 2), rowPadding = rowByteCount % 4, rowIndex = this.height - 1; rowIndex >= 0; rowIndex--) {
                for (let adjustedRowIndex = this.bottomUp ? rowIndex : this.height - 1 - rowIndex, pixelIndex = 0; pixelIndex < rowByteCount; pixelIndex++) {
                    const byteValue = this.buffer.readUInt8(this.pos++);
                    const dataIndex = adjustedRowIndex * this.width * 4 + 8 * pixelIndex;
                    const highPaletteEntry = this.palette[byteValue >> 4];

                    this.data[dataIndex] = 0;
                    this.data[dataIndex + 1] = highPaletteEntry.blue;
                    this.data[dataIndex + 2] = highPaletteEntry.green;
                    this.data[dataIndex + 3] = highPaletteEntry.red;

                    if (2 * pixelIndex + 1 >= this.width) break;

                    let lowPaletteEntry = this.palette[15 & byteValue];

                    this.data[dataIndex + 4] = 0;
                    this.data[dataIndex + 4 + 1] = lowPaletteEntry.blue;
                    this.data[dataIndex + 4 + 2] = lowPaletteEntry.green;
                    this.data[dataIndex + 4 + 3] = lowPaletteEntry.red;
                }

                if (rowPadding !== 0) this.pos += 4 - rowPadding;
            }
        }
    }

    bit8() {
        let dataIndex = 0;
        let rowIndex = 0;
        let rowPadding = 0;

        function processPixel(pixelIndex) {
            const paletteEntry = this.palette[pixelIndex];

            this.data[dataIndex] = 0;
            this.data[dataIndex + 1] = paletteEntry.blue;
            this.data[dataIndex + 2] = paletteEntry.green;
            this.data[dataIndex + 3] = paletteEntry.red;

            dataIndex += 4;
        }

        if (this.compress === 1) {
            this.data.fill(255);

            for (dataIndex = 0, rowIndex = this.bottomUp ? this.height - 1 : 0; dataIndex < this.data.length;) {
                const runLength = this.buffer.readUInt8(this.pos++);
                const runValue = this.buffer.readUInt8(this.pos++);

                if (runLength === 0) {
                    if (runValue === 0) {
                        this.bottomUp ? rowIndex-- : rowIndex++;
                        dataIndex = rowIndex * this.width * 4;

                        continue;
                    }

                    if (runValue === 1) break;

                    if (runValue === 2) {
                        const yOffset = this.buffer.readUInt8(this.pos++);
                        const xOffset = this.buffer.readUInt8(this.pos++);

                        this.bottomUp ? rowIndex -= yOffset : rowIndex += yOffset;
                        dataIndex += yOffset * this.width * 4 + 4 * xOffset;
                    } else {
                        for (let i = 0; i < runValue; i++) {
                            let pixelValue = this.buffer.readUInt8(this.pos++);
                            processPixel.call(this, pixelValue);
                        }

                        if (runValue & 1) this.pos++;
                    }
                } else {
                    for (let i = 0; i < runLength; i++) {
                        processPixel.call(this, runValue);
                    }
                }
            }
        } else {
            for (rowPadding = this.width % 4, rowIndex = this.height - 1; rowIndex >= 0; rowIndex--) {
                for (let adjustedRowIndex = this.bottomUp ? rowIndex : this.height - 1 - rowIndex, pixelIndex = 0; pixelIndex < this.width; pixelIndex++) {
                    const pixelValue = this.buffer.readUInt8(this.pos++);

                    dataIndex = adjustedRowIndex * this.width * 4 + 4 * pixelIndex;

                    if (pixelValue < this.palette.length) {
                        const paletteEntry = this.palette[pixelValue];

                        this.data[dataIndex] = 0;
                        this.data[dataIndex + 1] = paletteEntry.blue;
                        this.data[dataIndex + 2] = paletteEntry.green;
                        this.data[dataIndex + 3] = paletteEntry.red;
                    } else {
                        this.data[dataIndex] = 0;
                        this.data[dataIndex + 1] = 255;
                        this.data[dataIndex + 2] = 255;
                        this.data[dataIndex + 3] = 255;
                    }
                }

                if (rowPadding !== 0) this.pos += 4 - rowPadding;
            }
        }
    }

    bit15() {
        const widthMod3 = this.width % 3;
        const bitMask = parseInt('11111', 2);

        for (let rowIndex = this.height - 1; rowIndex >= 0; rowIndex--) {
            const adjustedRowIndex = this.bottomUp ? rowIndex : this.height - 1 - rowIndex;

            for (let pixelIndex = 0; pixelIndex < this.width; pixelIndex++) {
                const pixelValue = this.buffer.readUInt16LE(this.pos);

                this.pos += 2;

                const blue = (pixelValue & bitMask) / bitMask * 255 | 0;
                const green = (pixelValue >> 5 & bitMask) / bitMask * 255 | 0;
                const red = (pixelValue >> 10 & bitMask) / bitMask * 255 | 0;
                const alpha = pixelValue >> 15 ? 255 : 0;
                const dataIndex = adjustedRowIndex * this.width * 4 + 4 * pixelIndex;

                this.data[dataIndex] = alpha;
                this.data[dataIndex + 1] = blue;
                this.data[dataIndex + 2] = green;
                this.data[dataIndex + 3] = red;
            }

            this.pos += widthMod3;
        }
    }

    bit16() {
        const widthMod2 = this.width % 2 * 2;

        this.maskRed = 31744;
        this.maskGreen = 992;
        this.maskBlue = 31;
        this.mask0 = 0;

        if (this.compress === 3) {
            this.maskRed = this.buffer.readUInt32LE(this.pos); this.pos += 4;
            this.maskGreen = this.buffer.readUInt32LE(this.pos); this.pos += 4;
            this.maskBlue = this.buffer.readUInt32LE(this.pos); this.pos += 4;
            this.mask0 = this.buffer.readUInt32LE(this.pos); this.pos += 4;
        }

        const bitMasks = [0, 0, 0];

        for (let h = 0; h < 16; h++) {
            if (this.maskRed >> h & 1) bitMasks[0]++;
            if (this.maskGreen >> h & 1) bitMasks[1]++;
            if (this.maskBlue >> h & 1) bitMasks[2]++;
        }

        bitMasks[1] = bitMasks[1] + bitMasks[0];
        bitMasks[2] = bitMasks[2] + bitMasks[1];
        bitMasks[0] = 8 - bitMasks[0];
        bitMasks[1] = bitMasks[1] - 8;
        bitMasks[2] = bitMasks[2] - 8;

        for (let rowIndex = this.height - 1; rowIndex >= 0; rowIndex--) {
            const adjustedRowIndex = this.bottomUp ? rowIndex : this.height - 1 - rowIndex;

            for (let columnIndex = 0; columnIndex < this.width; columnIndex++) {
                const pixelValue = this.buffer.readUInt16LE(this.pos);

                this.pos += 2;

                const blue = (pixelValue & this.maskBlue) << bitMasks[0];
                const green = (pixelValue & this.maskGreen) >> bitMasks[1];
                const red = (pixelValue & this.maskRed) >> bitMasks[2];
                const dataIndex = adjustedRowIndex * this.width * 4 + 4 * columnIndex;

                this.data[dataIndex] = 0;
                this.data[dataIndex + 1] = blue;
                this.data[dataIndex + 2] = green;
                this.data[dataIndex + 3] = red;
            }

            this.pos += widthMod2;
        }
    }

    bit24() {
        for (let rowIndex = this.height - 1; rowIndex >= 0; rowIndex--) {
            const adjustedRowIndex = this.bottomUp ? rowIndex : this.height - 1 - rowIndex;

            for (let columnIndex = 0; columnIndex < this.width; columnIndex++) {
                const blue = this.buffer.readUInt8(this.pos++);
                const green = this.buffer.readUInt8(this.pos++);
                const red = this.buffer.readUInt8(this.pos++);
                const dataIndex = adjustedRowIndex * this.width * 4 + 4 * columnIndex;

                this.data[dataIndex] = 0;
                this.data[dataIndex + 1] = blue;
                this.data[dataIndex + 2] = green;
                this.data[dataIndex + 3] = red;
            }

            this.pos += this.width % 4;
        }
    }

    bit32() {
        if (this.compress === 3) {
            this.maskRed = this.buffer.readUInt32LE(this.pos); this.pos += 4;
            this.maskGreen = this.buffer.readUInt32LE(this.pos); this.pos += 4;
            this.maskBlue = this.buffer.readUInt32LE(this.pos); this.pos += 4;
            this.mask0 = this.buffer.readUInt32LE(this.pos); this.pos += 4;
        }

        for (let rowIndex = this.height - 1; rowIndex >= 0; rowIndex--) {
            const adjustedRowIndex = this.bottomUp ? rowIndex : this.height - 1 - rowIndex;

            for (let columnIndex = 0; columnIndex < this.width; columnIndex++) {
                const blue = this.buffer.readUInt8(this.pos++);
                const green = this.buffer.readUInt8(this.pos++);
                const red = this.buffer.readUInt8(this.pos++);
                const alpha = this.buffer.readUInt8(this.pos++);
                const dataIndex = adjustedRowIndex * this.width * 4 + 4 * columnIndex;

                this.data[dataIndex] = blue;
                this.data[dataIndex + 1] = green;
                this.data[dataIndex + 2] = red;
                this.data[dataIndex + 3] = alpha;
            }
        }
    }

    get getData() {
        return this.data;
    }
}

module.exports = (buffer) => {
    const { width, height, data, format } = new BmpDecoder(buffer);
    return { width, height, data, format };
};
