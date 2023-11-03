const ImageDecoder = require('../classes/ImageDecoder');
const format = require('../utils/format');

module.exports = function decodeImage(buffer) {
    return new ImageDecoder(buffer, format(buffer));
};
