module.exports = function format(buffer) {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
    else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
    else if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'bmp';
    else if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A || buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A) return 'tiff';

    return null;
};
