const ImageDecoder = require('../classes/ImageDecoder');
const format = require('./imageFormat');

module.exports = function decodeImage(buffer) {
    return new ImageDecoder(buffer, format(buffer));
};
