type FormatTypes = 'jpeg' | 'png' | 'bmp' | 'tiff';

interface FormatResult {
    width: number;
    height: number;
    data: Buffer;
    format: string;
}

export class ImageDecoder {
    constructor(buffer: Buffer, formatted: FormatTypes): FormatResult;

    jpeg(buffer: Buffer): FormatResult;
    png(buffer: Buffer): FormatResult;
    bmp(buffer: Buffer): FormatResult;
    tiff(buffer: Buffer): FormatResult;
}

export class ImageEncoder {
    constructor(data: FormatResult, formatted: FormatTypes): FormatResult;

    jpeg(data: FormatResult): FormatResult;
    png(data: FormatResult): FormatResult;
    bmp(data: FormatResult): FormatResult;
    tiff(data: FormatResult): FormatResult;
}

export function decodeImage(buffer: Buffer): FormatResult;
export function encodeImage(buffer: FormatResult, format: FormatTypes): FormatResult;

export function imageFormat(buffer: Buffer): FormatTypes | null;
