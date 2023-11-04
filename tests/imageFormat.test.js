const { readFileSync } = require('fs');
const { imageFormat } = require('../src');
const assert = require('assert');

module.exports = function testImageFormat() {
    const imagePNG = readFileSync('tests/images/test.png');
    const imageJPEG = readFileSync('tests/images/test.jpg');
    const imageBMP = readFileSync('tests/images/test.bmp');
    const imageTIFF = readFileSync('tests/images/test.tiff');

    assert.strictEqual(imageFormat(imagePNG), 'png');
    assert.strictEqual(imageFormat(imageJPEG), 'jpeg');
    assert.strictEqual(imageFormat(imageBMP), 'bmp');
    assert.strictEqual(imageFormat(imageTIFF), 'tiff');
}
