<div align="center">
    <a href="https://npmjs.com/package/@ambush/image"><img src="https://i.ibb.co/vvDBbXp/ambushimage-high-resolution-logo-1.png" width="500" alt="ambush" /></a>
    <p>
        <a href="https://www.npmjs.com/package/ambush"><img src="https://img.shields.io/npm/v/@ambush/image" alt="NPM Version"></a>
        <a href="https://www.npmjs.com/package/ambush"><img src="https://img.shields.io/npm/dt/@ambush/image" alt="NPM Downloads"></a>
        <!-- <a href="https://github.com/ambushjs/ambush/actions/tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/ambushjs/image/tests.yml" alt="GitHub Build"></a> -->
        <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://raw.githubusercontent.com/ambushjs/ambush/main/assets/license.svg" alt="GitHub License"></a>
    </p>
    <a href="https://github.com/ambushjs/ambush"><img src="https://raw.githubusercontent.com/ambushjs/ambush/main/assets/github.svg" alt="Made in GitHub"></a>
    <a href="https://github.com/ambushjs/ambush"><img src="https://raw.githubusercontent.com/ambushjs/ambush/main/assets/love.svg" alt="Made with Love"></a>
</div>

# Overview

<h6>
    Links:
    <a href="https://github.com/ambushjs/image">Github</a> |
    <a href="https://npmjs.com/package/@ambush/image">Package</a>
</h6>

This library is optimized for speed and resource efficiency but operates synchronously. Please note that synchronous operations may be slower than asynchronous alternatives. When using `@ambush/image` in performance-critical scenarios, consider asynchronous execution for optimal speed.

`@ambush/image` is a all-in-one, lightweight npm package designed for encoding and decoding various image formats without the need for external dependencies. This library simplifies image processing tasks, supporting popular formats like PNG, JPEG, BMP, and TIFF, offering seamless integration for developers and applications requiring image manipulation.

### Key Features

`@ambush/image` provides a user-friendly interface to efficiently encode and decode images in multiple formats, ensuring high-quality results.

- PNG (Portable Network Graphics)
- JPEG (Joint Photographic Experts Group)
- BMP (Bitmap Image)
- TIFF (Tagged Image File Format)

## Usage

Let's import this library and the `fs` library first.

```js
// CJS Modules
const ambushImg = require('@ambush/image');
const fs = require('fs');

// ES Modules
import ambushImg from '@ambush/image';
import fs from 'fs';
```

Here's a simple code snippet to decode & encode the image and save it using the `fs` library.

```js
const imageData = fs.readFileSync('image.png');

const decodedImage = ambushImg.decodeImage(imageData);
const encodedImage = ambushImg.encodeImage(decodedImage);

fs.writeFileSync('output.png', encodedImage.data);
```

---

## Contributing

We welcome contributions from the community to improve and enhance this project. Whether you're a developer, designer, tester, or have ideas to share, your help is valuable. If you're willing to contribute and get involved, please see [the contributing guide](https://github.com/ambushjs/image/tree/main/CONTRIBUTING.md) file for more details.

We adhere to the [Code of Conduct](https://github.com/ambushjs/image/tree/main/CODE_OF_CONDUCT.md) to ensure a respectful and inclusive community. Please review it and follow the guidelines when participating in this project.

If you have any problems, issues or questions please email us at [ambush.js.org@gmail.com](mailto:ambush.js.org@gmail.com)

## License

[This project](https://github.com/ambushjs/imagee/blob/main/LICENSE) is licensed under the [Apache License 2.0](https://apache.org/licenses/LICENSE-2.0).

Copyright © 2023 Ambush, Inc.
