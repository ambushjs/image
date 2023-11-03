class BmpEncoder {
    constructor(data) {
        this.buffer = data.data;
        this.width = data.width;
        this.height = data.height;
        this.extraBytes = this.width % 4;
        this.rgbSize = this.height * (3 * this.width + this.extraBytes);
        this.headerInfoSize = 40;
        this.flag = 'BM';
        this.reserved = 0;
        this.offset = 54;
        this.fileSize = this.rgbSize + this.offset;
        this.planes = 1;
        this.bitPP = 24;
        this.compress = 0;
        this.hr = 0;
        this.vr = 0;
        this.colors = 0;
        this.importantColors = 0;
    }

    encode() {
        const t = Buffer.alloc(this.offset + this.rgbSize);

        this.pos = 0;

        t.write(this.flag, this.pos, 2); this.pos += 2;
        t.writeUInt32LE(this.fileSize, this.pos); this.pos += 4;
        t.writeUInt32LE(this.reserved, this.pos); this.pos += 4;
        t.writeUInt32LE(this.offset, this.pos); this.pos += 4;
        t.writeUInt32LE(this.headerInfoSize, this.pos); this.pos += 4;
        t.writeUInt32LE(this.width, this.pos); this.pos += 4;
        t.writeInt32LE(-this.height, this.pos); this.pos += 4;
        t.writeUInt16LE(this.planes, this.pos); this.pos += 2;
        t.writeUInt16LE(this.bitPP, this.pos); this.pos += 2;
        t.writeUInt32LE(this.compress, this.pos); this.pos += 4;
        t.writeUInt32LE(this.rgbSize, this.pos); this.pos += 4;
        t.writeUInt32LE(this.hr, this.pos); this.pos += 4;
        t.writeUInt32LE(this.vr, this.pos); this.pos += 4;
        t.writeUInt32LE(this.colors, this.pos); this.pos += 4;
        t.writeUInt32LE(this.importantColors, this.pos); this.pos += 4;

        for (let s = 0, i = 3 * this.width + this.extraBytes, h = 0; h < this.height; h++) {
            for (let e = 0; e < this.width; e++) {
                const o = this.pos + h * i + 3 * e;

                s++;

                t[o] = this.buffer[s++];
                t[o + 1] = this.buffer[s++];
                t[o + 2] = this.buffer[s++];
            }

            if (this.extraBytes > 0) {
                const r = this.pos + h * i + 3 * this.width;
                t.fill(0, r, r + this.extraBytes);
            }
        }

        return t;
    }
}

module.exports = function bmp(data) {
    return {
        data: new BmpEncoder(data).encode(),
        width: data.width,
        height: data.height,
    };
};
