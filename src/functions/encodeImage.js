const ImageEncoder = require('../classes/ImageEncoder');

module.exports = function encodeImage(decoded, format) {
    return new ImageEncoder(decoded, format ?? decoded.format);
};
