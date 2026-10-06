import sharp from "sharp";

// Test images are generated, never checked in as binary files.
export const makeImage = async ({ width = 120, height = 80, format = "jpeg", exif = false } = {}) => {
    let image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } });
    if (exif) {
        // GPS coordinates and a camera make: the kind of metadata that must never be published
        image = image.withExif({
            IFD0: { Make: "SecretCam", Software: "Secret Editor" },
            GPSIFD: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
        });
    }
    return image[format]().toBuffer();
};

export const textFile = (text = "this is not an image, just text pretending") => Buffer.from(text);

export const svgFile = () =>
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>');

// a tiny file that claims to be a huge image: a "decompression bomb"
export const pixelBomb = () => sharp({ create: { width: 6000, height: 6000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
