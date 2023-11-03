const { PNG } = require('pngjs');
const { decodeBMP } = require('../processors/bmp');
const { decode, decodeImage, toRGBA8 } = require('../processors/tiff');
const decodeJPEG = require('../decoders/jpeg');

module.exports = class ImageDecoder {
    constructor(buffer, formatted) {
        if (formatted === 'unknown') throw new TypeError('[AmbushImage] Given image format is not valid.');

        return this[formatted](buffer);
    }

    jpeg(buffer) {
        return decodeJPEG(buffer);
    }

    png(buffer) {
        return PNG.sync.read(buffer);
    }

    bmp(buffer) {
        return decodeBMP(buffer);
    }

    tiff(buffer) {
        const ifds = decode(buffer)[0];

        decodeImage(buffer, ifds);

        return {
            width: ifds.width,
            height: ifds.height,
            data: toRGBA8(ifds),
            format: 'tiff',
        };
    }
};
