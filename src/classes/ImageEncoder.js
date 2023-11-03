const { PNG } = require('pngjs');
const { encodeBMP } = require('../processors/bmp');
const { encodeImage } = require('../processors/tiff');
const encodeJPEG = require('../encoders/jpeg');

module.exports = class ImageEncoder {
    constructor(data, formatted) {
        if (formatted === 'unknown') throw new TypeError('[AmbushImage] Given image format is not valid.');

        return this[formatted](data);
    }

    jpeg(data) {
        return encodeJPEG(data);
    }

    png(data) {
        return {
            width: data.width,
            height: data.height,
            data: PNG.sync.write(data),
            format: 'png',
        };
    }

    bmp(data) {
        return encodeBMP(data);
    }

    tiff(data) {
        return {
            width: data.width,
            height: data.height,
            data: Buffer.from(encodeImage(data.data, data.width, data.height)),
            format: 'tiff',
        };
    }
};
