const decode = require('../decoders/bmp');
const encode = require('../encoders/bmp');

function scan(image, startX, startY, width, height, pixelFunction) {
    const initX = Math.round(startX);
    const initY = Math.round(startY);

    for (let y = initY; y < initY + Math.round(height); y++) {
        for (let x = initX; x < initX + Math.round(width); x++) {
            const pixelIndex = image.bitmap.width * y + x << 2;
            pixelFunction.call(image, x, y, pixelIndex);
        }
    }

    return image;
}

function toAGBR(bitmap) {
    return scan({ bitmap }, 0, 0, bitmap.width, bitmap.height, (_, __, index) => {
        const red = bitmap.data[index + 0];
        const green = bitmap.data[index + 1];
        const blue = bitmap.data[index + 2];
        const alpha = bitmap.data[index + 3];

        bitmap.data[index + 0] = alpha;
        bitmap.data[index + 1] = blue;
        bitmap.data[index + 2] = green;
        bitmap.data[index + 3] = red;
    }).bitmap;
}

function fromAGBR(bitmap) {
    return scan({ bitmap }, 0, 0, bitmap.width, bitmap.height, (_, __, index) => {
        const alpha = bitmap.data[index + 0];
        const blue = bitmap.data[index + 1];
        const green = bitmap.data[index + 2];
        const red = bitmap.data[index + 3];

        bitmap.data[index + 0] = red;
        bitmap.data[index + 1] = green;
        bitmap.data[index + 2] = blue;
        bitmap.data[index + 3] = bitmap.isWithAlpha ? alpha : 0xff;
    }).bitmap;
}

exports.decodeBMP = function decodeBMP(data) {
    return fromAGBR(decode(data));
};

exports.encodeBMP = function encodeBMP(image) {
    return encode(toAGBR(image));
};
